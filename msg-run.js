/* Copyright (c) 2019 voxgig and other contributors, MIT License */
'use strict'


const Util = require('util')

const XState = require('xstate')


module.exports = msg_run
module.exports.defaults = {
  dest: []
}
module.exports.errors = {}


function msg_run(options) {
  var seneca = this

  const clock = intern.make_clock(options)
  
  const machine = intern.make_scenario_machine(options.spec, intern.validate)
  
  const ctx = {
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
    store: [],

  }
  
  
  seneca
    .message('sys:msg-run,cmd:start', cmd_start)
    .message('sys:msg-run,cmd:stop', cmd_stop)
    .message('sys:msg-run,get:previous', get_previous)
    .message('sys:msg-run,get:current', get_current)
    .message('sys:msg-run,get:status', get_status)
    .message('sys:msg-run,get:history', get_history)

    // .prepare(async function prepare_msg_run() {})

  async function cmd_start(msg) {
    return this.util.deep(intern.start(this, clock, msg, ctx, machine))
  }

  async function cmd_stop(msg) {
    return this.util.deep(intern.stop(msg, ctx))
  }

  async function get_previous(msg) {
    return intern.get_test_results(msg, ctx.previous)
  }

  async function get_current(msg) {
    return intern.get_test_results(msg, ctx.current)
  }

  async function get_status(msg) {
    var current_test = ctx.status.current_test
    if(current_test.start) {
      current_test.elapsed = Date.now() - current_test.start
    }
    return this.util.deep(ctx.status)
  }

  async function get_history(msg) {
    var history = {
      // TODO: move get_status to intern pure function
      status: await get_status.call(this,msg)
    }
    
    if(msg.full) {
      history.store = ctx.store
    }

    // summary table
    else {
      var table = []
      for(var i = ctx.store.length-1; ctx.store.length-10 < i && -1 < i; --i) {
        var run = ctx.store[i]
        var passed = 0
        var failed = 0

        for(var tI = 0; tI < run.tests.length; tI++) {
          passed++
        }
        
        var row = [
          run.start,
          run.run,
          run.duration,
          passed,
          failed
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
    return true
  },

  execute_test: async function(seneca, test_spec, machine) {
    var machine_context = {
      seneca: () => seneca,
      test_spec: test_spec,
      index: 0,
      results: []
    }

    const interpreter =
          intern.make_scenario_interpreter(machine, machine_context)
    
    return new Promise(resolve=>{
      interpreter.onDone(function() {
        var final_context = {
          test_spec: test_spec,
          results: machine_context.results
        }
        resolve(final_context)
      })

      interpreter.start()
    })
  },

  runner: function(seneca, clock, msg, ctx, machine) {
    if(ctx.status.running) return ctx.status;
    
    ctx.status.running = true
    run_tests()

    return ctx.status;
    
    async function run_tests() {
      if(!ctx.status.running) return;

      ctx.previous = ctx.current

      ctx.current = {
        start: Date.now(),
        tests: [],
      }
      
      var tests = ctx.spec.tests
      
      for(var tI = 0; tI < tests.length; tI++) {
        if(!ctx.status.running) {
          break
        }
        
        var test_spec = tests[tI]
        var test_start = Date.now()

        ctx.status.current_test.name = test_spec.name
        ctx.status.current_test.start = test_start

        var test_result = await intern.execute_test(seneca, test_spec, machine)
        
        ctx.status.current_test.name = null
        ctx.status.current_test.start = null
        ctx.status.current_test.elapsed = null
        
        test_result.name = test_spec.name
        test_result.start = test_start
        test_result.end = Date.now()
        test_result.duration = test_result.end - test_start

        ctx.current.tests.push(test_result)
      }

      ctx.current.run = ctx.status.runs
      ctx.current.end = Date.now()
      ctx.current.duration = ctx.current.end - ctx.current.start

      //console.log('ALL END', ctx)
      intern.store(ctx)

      ctx.status.runs++
      
      if(ctx.status.running) {
        clock.setTimeout(run_tests, ctx.spec.interval)
      }
    }
  },
  start: function(seneca, clock, msg, ctx, machine) {
    return intern.runner(seneca, clock, msg, ctx, machine)
  },

  stop: function(msg,ctx) {
    ctx.status.running = false
    return ctx.status
  },
  
  get_test_results: function (msg, src) {
    var include_log = !!msg.log

    var out = {
      run: src.run,
      start: src.start,
      end: src.end,
      duration: src.duration,
      tests: src.tests,
    }

    // include msg and response data
    if(include_log) {
      out.log = src.log
    }

    return out
  },

  store: function(ctx) {
    if(ctx.current.start) {
      var stored_test = {...ctx.current}
      ctx.store.push(stored_test)
    }
  },


  make_scenario_machine: function(spec, validate) {
    const config = {
      actions: {
        update_res: XState.assign({
          res: (ctx, event) => ({kind:'out', msg:ctx.msg, out:event.data})
        }),

        validate_res: XState.assign({
          valid: ctx => {
            return validate(ctx)
          }
        }),
        
        result_entry: (ctx, event) => {
          ctx.results.push({
            msg: ctx.msg,
            res: ctx.res,
          })
          ctx.index++
        },
      },
      services: {
        outbound_send: (ctx, event) => {
          var index = ctx.index

          // TODO: pre process this
          var msgparts = ctx.test_spec.scenario[index].msg
          msgparts = Array.isArray(msgparts) ? msgparts : [msgparts]
          msgparts.unshift({})
          msgparts = msgparts.map(x=>ctx.seneca().util.Jsonic(x))

          ctx.msg = ctx.seneca().util.deep.apply(null,msgparts)
          return ctx.seneca().post(ctx.msg)
        }
      },
      guards: {
        result_validate: (ctx,event) => {
          var pass = true // 4 == event.data.x
          return pass
        },
        result_is_invalid: (ctx) => {
          return !ctx.valid
        },
        result_has_more_msgs: (ctx) => {
          var pass = ctx.index < (ctx.test_spec.scenario.length-1)
          return pass
        }
      }
    }
    
    const machine = XState.Machine({
      id: 'msgrun',
      initial: 'outbound',
      states: {

        outbound: {
          invoke: {
            id: 'send',
            src: 'outbound_send',
            onDone: {
              target: 'result',
              actions: [
                'update_res',
                'validate_res',
              ]
            },
            onError: {
              target: 'result'
            }
          }
        },

        inbound: {
          on: {
            MESSAGE: 'message',
            RESULT: 'result',
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
          type: 'final'
        },
        
        fail: {
          type: 'final'
        }
        
      }
    }, config)


    return machine
  },

  make_scenario_interpreter: function(machine, ctx) {
    const machine_instance = machine.withContext(ctx)

    const interpreter = XState
          .interpret(machine_instance)
          .onTransition(state => {
            console.log(intern.aligner([
              0, 'TRANSITION',
              16, state.value,
              16, state.event.type,
              8, state.context.test_spec.name,
              0, state.context.msg,
              0, state.context.res && state.context.res.out,
              0, state.context.index
            ]))
          })
    
    return interpreter
  },

  make_clock: function(options) {
    var clock = options.clock

    if(!options.clock) {
      clock = {
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
      }
    }

    return clock
  },

  aligner: function (line) {
    var out = []
    for(var i = 0; i < line.length; i+=2) {
      var len = line[i]
      var str = line[i+1]
      
      if('string' !== typeof(str)) {
        str = Util.inspect(str, {breakLength: Infinity})
      }
      
      if(0 == len) {
        len = str.length + 1
      }
      
      out.push(str.padEnd(len, ' '))
    }
    return out.join('')
  }
  
})


