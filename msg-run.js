/* Copyright (c) 2019 voxgig and other contributors, MIT License */
'use strict'

// const Util = require('util')

const Joi = require('@hapi/joi')
const XState = require('xstate')

module.exports = msg_run
module.exports.defaults = {
  test: Joi.boolean().default(true),
  spec: Joi.object({
    name: Joi.string().required(),
    interval: Joi.number().default(111111),
    tests: Joi.array()
      .items({
        name: Joi.string().required(),
        scenario: Joi.array().default([])
      })
      .required()
  }).default()
}
module.exports.errors = {}

function msg_run(options) {
  var seneca = this

  const clock = intern.make_clock(options)

  const machine = intern.make_scenario_machine(options.spec, intern.validate)

  const pi = {
    spec: options.spec,
    previous: {},
    current: {},
    status: {
      running: false,
      runs: 0,
      since: Date.now(),
      current_test: {}
    },

    // TODO: save as entity
    store: []
  }

  seneca
    .message('sys:msg-run,set:spec', set_spec)
    .message('sys:msg-run,get:spec', get_spec)
    .message('sys:msg-run,cmd:start', cmd_start)
    .message('sys:msg-run,cmd:stop', cmd_stop)
    .message('sys:msg-run,get:previous', get_previous)
    .message('sys:msg-run,get:current', get_current)
    .message('sys:msg-run,get:status', get_status)
    .message('sys:msg-run,get:history', get_history)
    .message('sys:msg-run,get:store', get_store)

  // .prepare(async function prepare_msg_run() {})

  // TODO: validate spec
  async function set_spec(msg) {
    pi.spec = msg.spec
    return { ok: true }
  }

  async function get_spec(msg) {
    return pi.spec
  }

  async function cmd_start(msg) {
    var run_seneca = this.root.delegate()
    return this.util.deep(intern.start(run_seneca, clock, msg, pi, machine))
  }

  async function cmd_stop(msg) {
    return this.util.deep(intern.stop(msg, pi))
  }

  async function get_previous(msg) {
    return intern.get_test_results(msg, pi.previous)
  }

  async function get_current(msg) {
    return intern.get_test_results(msg, pi.current)
  }

  async function get_status(msg) {
    var current_test = pi.status.current_test
    if (current_test.start) {
      current_test.elapsed = Date.now() - current_test.start
    }
    return this.util.deep(pi.status)
  }

  async function get_history(msg) {
    var seneca = this
    var limit = msg.limit || 11
    //var table = !!msg.table
    var run_id = msg.run_id
    var as_data = !!msg.as_data
    var out = {}

    if (null == run_id) {
      var msgrunlist = await seneca
        .entity('sys/msgrun')
        .list$({ limit$: limit })

      if (as_data) {
        msgrunlist = msgrunlist.map(x => x.data$())
      }

      out.runs = msgrunlist
    } else {
      var msgrun = await seneca.entity('sys/msgrun').load$(msg.run_id)
      if (msgrun) {
        out.run = msgrun
        var msgrunentrylist = await seneca
          .entity('sys/msgrunentry')
          .list$({ msgrun_id: msgrun.id })

        if (as_data) {
          msgrunentrylist = msgrunentrylist.map(x => x.data$())
        }

        out.entries = msgrunentrylist
      }
    }

    return out
  }

  async function get_store(msg) {
    var history = {
      // TODO: move get_status to intern pure function
      status: await get_status.call(this, msg)
    }

    if (msg.full) {
      history.store = pi.store
    }

    // summary table
    else {
      var table = []
      for (
        var i = pi.store.length - 1;
        pi.store.length - 10 < i && -1 < i;
        --i
      ) {
        var run = pi.store[i]
        var passed = 0
        var failed = 0
        var fail_names = []

        for (var tI = 0; tI < run.tests.length; tI++) {
          var test = run.tests[tI]
          if (test.pass) {
            passed++
          } else {
            failed++
            fail_names.push(test.name)
          }
        }

        var row = [
          run.start,
          run.run,
          run.duration,
          passed,
          failed,
          0 < failed ? 'F' : 'P',
          fail_names.join(',')
        ]

        table.push(row)
      }

      history.summary = table
    }

    return history
  }
}

const intern = (msg_run.intern = {
  validate: function(ctx) {
    var scenario_step = ctx.test_spec.scenario[ctx.index]

    // unexpected error
    if (ctx.res.err && scenario_step.out) {
      return false
    }

    // unexpected output (when it should have been an expected error)
    if (ctx.res.out && scenario_step.err) {
      return false
    }

    var match = scenario_step.err || scenario_step.out
    var actual = ctx.res.err || ctx.res.out

    if (null == match && null == actual) {
      return true
    }

    // cache optioner
    var check = scenario_step.check && scenario_step.check()

    if (!check) {
      check = ctx.seneca().util.Optioner(match, { must_match_literals: true })
      scenario_step.check = () => check
    }

    ctx.match = match
    ctx.check = check(actual)

    return null == ctx.check.error
  },

  execute_test: async function(seneca, test_spec, machine) {
    return new Promise(resolve => {
      var machine_context = {
        seneca: () => seneca,
        finish: ctx => resolve(ctx),
        test_spec: test_spec,
        index: 0,
        results: []
      }

      const interpreter = intern.make_scenario_interpreter(
        machine,
        machine_context
      )

      interpreter.start()
    })
  },

  runner: function(seneca, clock, msg, pi, machine) {
    if (pi.status.running) return pi.status

    pi.status.running = true
    run_tests()

    return pi.status

    async function run_tests() {
      if (!pi.status.running) return

      pi.previous = pi.current

      pi.current = {
        start: Date.now(),
        tests: []
      }

      var tests = pi.spec.tests

      for (var tI = 0; tI < tests.length; tI++) {
        if (!pi.status.running) {
          break
        }

        var test_spec = tests[tI]
        var test_start = Date.now()

        pi.status.current_test.name = test_spec.name
        pi.status.current_test.start = test_start

        var test_result = await intern.execute_test(seneca, test_spec, machine)
        // console.log('TR', test_result)

        pi.status.current_test.name = null
        pi.status.current_test.start = null
        pi.status.current_test.elapsed = null

        test_result.name = test_spec.name
        test_result.start = test_start
        test_result.end = Date.now()
        test_result.duration = test_result.end - test_start

        pi.current.tests.push(test_result)
      }

      pi.current.run = pi.status.runs
      pi.current.end = Date.now()
      pi.current.duration = pi.current.end - pi.current.start

      //console.log('ALL END', pi)
      await intern.store(seneca, pi)

      pi.status.runs++

      if (pi.status.running) {
        clock.setTimeout(run_tests, pi.spec.interval)
      }
    }
  },
  start: function(seneca, clock, msg, pi, machine) {
    return intern.runner(seneca, clock, msg, pi, machine)
  },

  stop: function(msg, pi) {
    pi.status.running = false
    return pi.status
  },

  get_test_results: function(msg, src) {
    var out = {
      run: src.run,
      start: src.start,
      end: src.end,
      duration: src.duration,
      tests: src.tests
    }

    return out
  },

  store: async function(seneca, pi) {
    if (pi.current.start) {
      var stored_test = { ...pi.current }
      pi.store.push(stored_test)

      // prune
      if (11 < pi.store.length) {
        pi.store.unshift()
      }

      var run = pi.current
      //console.dir(run, {depth:9})

      var passed = 0
      var failed = 0
      var fail_names = []
      var entries = []
      for (var tI = 0; tI < run.tests.length; tI++) {
        var test = run.tests[tI]
        if (test.pass) {
          passed++
        } else {
          failed++
          fail_names.push(test.name)
        }

        for (var rI = 0; rI < test.results.length; rI++) {
          var res = test.results[rI].res
          var entry = {
            run_name: pi.spec.name,
            test_name: test.test_spec.name,
            pattern: res.pattern,
            start: res.start,
            end: res.end,
            duration: res.duration,
            kind: res.kind,
            seq: rI,
            pass: res.pass
          }

          if (!entry.pass) {
            entry.details = {
              msg: res.msg,
              out: res.out,
              err: res.err,
              match: res.match,
              check: res.check
            }
          }

          entries.push(entry)
        }
      }

      var msgrundata = {
        name: pi.spec.name,
        start: run.start,
        duration: run.duration,
        passed: passed,
        failed: failed,
        status: 0 < failed ? 'F' : 'P',
        fail_names: fail_names.join(',')
      }

      var msgrun = await seneca
        .entity('sys/msgrun')
        .data$(msgrundata)
        .save$()
      //console.log(msgrun.data$())

      for (var eI = 0; eI < entries.length; eI++) {
        entry = entries[eI]
        entry.msgrun_id = msgrun.id
        await seneca
          .entity('sys/msgrunentry')
          .data$(entry)
          .save$()
        //console.log(msgrunentry.data$())
      }
    }
  },

  make_scenario_machine: function(spec, validate) {
    const config = {
      actions: {
        update_res: XState.assign({
          res: (ctx, event) => {
            // console.log('UPDATE_RES', ctx.msg)

            var msg_end = Date.now()
            var res = {
              msg: ctx.msg,
              start: ctx.msg_start,
              end: msg_end,
              duration: msg_end - ctx.msg_start,
              pattern: ctx.msg_pattern
            }

            if (event.data instanceof Error) {
              res.kind = 'err'
              res.err = event.data
            } else {
              res.kind = 'out'
              res.out = event.data
            }

            return res
          }
        }),

        validate_res: XState.assign({
          valid: ctx => {
            // console.log('VALIDATE_RES', ctx.msg)
            var pass = validate(ctx)
            ctx.res.pass = pass
            return pass
          }
        }),

        result_entry: (ctx, event) => {
          ctx.results.push({
            msg: ctx.msg,
            res: ctx.res
          })
          ctx.index++
        }
      },
      services: {
        outbound_send: (ctx, event) => {
          var index = ctx.index

          // TODO: pre process this
          var msgparts = ctx.test_spec.scenario[index].msg
          msgparts = Array.isArray(msgparts) ? msgparts : [msgparts]
          ctx.msg_pattern = ctx.seneca().util.Jsonic.stringify(msgparts[0])

          if (ctx.test_spec.fix) {
            var fix = ctx.seneca().util.Jsonic(ctx.test_spec.fix)
            msgparts.unshift(fix)
          }

          msgparts.unshift({})

          msgparts = msgparts.map(x => ctx.seneca().util.Jsonic(x))

          ctx.msg = ctx.seneca().util.deep.apply(null, msgparts)
          ctx.msg_start = Date.now()
          return ctx.seneca().post(ctx.msg)
        }
      },
      guards: {
        result_is_invalid: ctx => {
          return !ctx.valid
        },
        result_has_more_msgs: ctx => {
          return ctx.index < ctx.test_spec.scenario.length - 1
        }
      }
    }

    const machine = XState.Machine(
      {
        id: 'msgrun',
        initial: 'outbound',
        states: {
          outbound: {
            invoke: {
              id: 'send',
              src: 'outbound_send',
              onDone: {
                target: 'result',
                actions: ['update_res', 'validate_res']
              },
              onError: {
                target: 'result',
                actions: ['update_res', 'validate_res']
              }
            }
          },

          inbound: {
            on: {
              MESSAGE: 'message',
              RESULT: 'result'
            }
          },

          message: {
            on: { '': 'inbound' }
          },

          result: {
            entry: 'result_entry',
            on: {
              '': [
                { target: 'fail', cond: 'result_is_invalid' },
                { target: 'outbound', cond: 'result_has_more_msgs' },
                { target: 'pass' }
              ]
            }
          },

          pass: {
            entry: XState.assign({ pass: true }),
            on: { '': 'stop' }
          },

          fail: {
            entry: XState.assign({ pass: false }),
            on: { '': 'stop' }
          },

          stop: {
            entry: ctx => {
              ctx.finish(ctx)
            },
            type: 'final'
          }
        }
      },
      config
    )

    return machine
  },

  make_scenario_interpreter: function(machine, ctx) {
    ctx.mark = Math.random()
    const machine_instance = machine.withContext(ctx)

    const interpreter = XState.interpret(machine_instance).onTransition(
      state => {
        /*
            console.log(intern.aligner([
              0, 'TRANSITION',
              12, state.value,
              20, state.event.type,
              8, state.context.test_spec.name,
              0, state.context.msg,
              0, state.context.res && state.context.res.out,
              0, state.context.index
            ]))
            */
      }
    )

    return interpreter
  },

  make_clock: function(options) {
    var clock = options.clock

    if (!options.clock) {
      clock = {
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval
      }
    }

    return clock
  }

  /*
  aligner: function(line) {
    var out = []
    for (var i = 0; i < line.length; i += 2) {
      var len = line[i]
      var str = line[i + 1]

      if ('string' !== typeof str) {
        str = Util.inspect(str, { breakLength: Infinity })
      }

      if (0 == len) {
        len = str.length + 1
      }

      out.push(str.padEnd(len, ' '))
    }
    return out.join('')
  }
  */
})
