/* Copyright (c) 2019 voxgig and other contributors, MIT License */
'use strict'

// const Util = require('util')

const Lolex = require('lolex')

const Lab = require('@hapi/lab')
const Code = require('@hapi/code')
const lab = (exports.lab = Lab.script())
const expect = Code.expect

const PluginValidator = require('seneca-plugin-validator')
const Seneca = require('seneca')
const Plugin = require('..')

lab.test('validate', PluginValidator(Plugin, module))

lab.test('happy', { timeout: 5555 }, async () => {
  var spec = {
    name: 'happy',
    interval: 100,
    tests: [
      {
        name: 't0',
        // fix: { b: 1 },
        scenario: [{ msg: ['a:1', { x: 2 }], out: { x: 2 } }],
      },
      {
        name: 't1',
        scenario: [
          { name: 's0', msg: ['a:1', { x: 3 }], out: { x: 3 } },
          { msg: ['a:2', { y: 4 }], out: { y: 4 } },
          { msg: ['a:1', { x: 5, z: '`s0:out.x`' }], out: { x: 5, z: 3 } },
        ],
      },
    ],
  }

  var clock = Lolex.createClock()

  var si = await seneca_instance({}, { spec: spec, clock: clock }).ready()
  expect(si).exists()

  si.message('a:1', async (m) => {
    var out = { x: m.x }
    if (m.z) {
      out.z = m.z
    }
    return out
  })

  si.message('a:2', async (m) => {
    return { y: m.y }
  })

  var status0 = await si.post('sys:msg-run,get:status')
  //console.log('status0', status0)
  expect(status0).contains({ running: false, runs: 0 })

  var current0 = await si.post('sys:msg-run,get:current')
  //console.log('current0', current0)
  expect(current0).equals({
    start: undefined,
    end: undefined,
    run: undefined,
    duration: undefined,
    tests: undefined,
  })

  var previous0 = await si.post('sys:msg-run,get:previous')
  //console.log('previous0', previous0)
  expect(previous0).equals({
    start: undefined,
    end: undefined,
    run: undefined,
    duration: undefined,
    tests: undefined,
  })

  var start0 = await si.post('sys:msg-run,cmd:start')
  //console.log('start0', start0)
  expect(start0).contains({ running: true })

  // runs all the msgs of all the tests to completion
  await si.ready()
  //await sleep(55)

  var status1 = await si.post('sys:msg-run,get:status')
  //console.log('status1', status1)
  expect(status1).contains({ running: true, runs: 1 })

  var previous1 = await si.post('sys:msg-run,get:previous')
  //console.log('previous1', previous1)
  expect(previous1).equals({
    start: undefined,
    end: undefined,
    run: undefined,
    duration: undefined,
    tests: undefined,
  })

  var current1 = await si.post('sys:msg-run,get:current')
  //console.log('current1')
  //console.dir(current1,{depth:5})
  expect(current1.run).equal(0)
  expect(current1.duration).above(0)
  expect(current1.tests.length).equal(2)
  expect(current1.tests[0].results.length).equal(1)
  expect(current1.tests[0].pass).true()
  expect(current1.tests[1].results.length).equal(3)
  expect(current1.tests[1].pass).true()

  var store0 = await si.post('sys:msg-run,get:store,full:true')
  //console.log('STORE')
  //console.dir(store,{depth:6})
  expect(store0.store.length).equal(1)

  var store1 = await si.post('sys:msg-run,get:store')
  //console.log('STORE SUMMARY')
  //console.dir(store1)
  expect(store1.summary.length).equal(1)

  clock.tick(100)
  await si.ready()

  var store2 = await si.post('sys:msg-run,get:store')
  //console.log('STORE SUMMARY')
  //console.dir(store2)
  expect(store2.summary.length).equal(2)

  var status2 = await si.post('sys:msg-run,get:status')
  //console.log('status2', status2)
  expect(status2).contains({ running: true, runs: 2 })

  var stop0 = await si.post('sys:msg-run,cmd:stop')
  //console.log('stop0', stop0)
  expect(stop0).contains({ running: false, runs: 2 })

  clock.tick(100)
  await si.ready()

  var status3 = await si.post('sys:msg-run,get:status')
  //console.log('status3', status3)
  expect(status3).contains({ running: false, runs: 2 })

  clock.tick(100)
  await si.ready()

  var status4 = await si.post('sys:msg-run,get:status')
  //console.log('status4', status4)
  expect(status4).contains({ running: false, runs: 2 })

  var start1 = await si.post('sys:msg-run,cmd:start')
  //console.log('start1', start1)
  expect(start1).contains({ running: true, runs: 2 })

  clock.tick(100)
  await si.ready()

  var status5 = await si.post('sys:msg-run,get:status')
  //console.log('status5', status5)
  expect(status5).contains({ running: true, runs: 3 })

  var current2 = await si.post('sys:msg-run,get:current')
  //console.log('current2')
  //console.dir(current2,{depth:5})
  expect(current2.run).equal(2) // runs 0,1,2 completed
  expect(current2.duration).above(0)
  expect(current2.tests.length).equal(2)
  expect(current2.tests[0].results.length).equal(1)
  expect(current2.tests[1].results.length).equal(3)

  var previous2 = await si.post('sys:msg-run,get:previous')
  expect(previous2.run).equal(1)
  expect(previous2.duration).above(0)
  expect(previous2.tests.length).equal(2)
  expect(previous2.tests[0].results.length).equal(1)
  expect(previous2.tests[1].results.length).equal(3)

  var store3 = await si.post('sys:msg-run,get:store')
  //console.log('STORE')
  //console.dir(store3)
  expect(store3.summary.length).equal(3)

  var history0 = await si.post('sys:msg-run,get:history,as:data')
  //console.log(history0)
  //console.table(history0.runs)
  expect(history0.runs.length).equal(3)

  var history1 = await si.post(
    'sys:msg-run,get:history,run_id:' + history0.runs[0].id + ',as:data'
  )
  //console.log(history1.run)
  //console.table(history1.entries)
  expect(history1.run.id).equals(history0.runs[0].id)
  expect(history1.entries.length).equal(4)
})

lab.test('validate-result', { timeout: 5555 }, async () => {
  var spec = {
    name: 'validate-result',
    interval: 100,
    tests: [
      {
        name: 't0',
        scenario: [
          { msg: ['a:1', { x: 2 }], out: { x: 2 } },
          { msg: ['a:1', { x: 3 }], out: { x: 3 } },
          { msg: ['a:1', { x: 4 }], out: { x: 4 } },
        ],
      },
    ],
  }

  var clock = Lolex.createClock()

  var si = await seneca_instance(
    { log: 'silent' },
    { spec: spec, clock: clock }
  ).ready()
  expect(si).exists()

  si.message('a:1', async (m) => {
    return 3 === m.x ? { x: 'bad' } : { x: m.x }
  })

  console.log('AAA')

  await si.post('sys:msg-run,cmd:start')
  await si.ready()

  var status0 = await si.post('sys:msg-run,get:status')
  console.log('status0', status0)
  expect(status0).contains({ running: true, runs: 1 })

  var current0 = await si.post('sys:msg-run,get:current')
  console.log('current0')
  console.dir(current0, { depth: 5 })
  expect(current0.tests[0].pass).equals(false)

  var store0 = await si.post('sys:msg-run,get:store')
  //console.log('STORE')
  //console.dir(store0,{depth:6})
  expect(store0.summary.length).equal(1)

  clock.tick(100)
  await si.ready()

  var store1 = await si.post('sys:msg-run,get:store')
  //console.log('STORE')
  //console.dir(store1,{depth:6})
  expect(store1.summary.length).equal(2)
})

lab.test('match-error', { timeout: 3333 }, async () => {
  var spec = {
    name: 'match-error',
    interval: 100,
    tests: [
      {
        name: 't0',
        scenario: [
          { msg: ['a:1', { x: 2 }], out: { x: 2 } },
          { msg: ['a:1', { x: 3 }], err: { code: 'bad' } },
          { msg: ['a:1', { x: 4 }], out: { x: 4 } },
        ],
      },
    ],
  }

  var clock = Lolex.createClock()

  var si = await seneca_instance(
    { log: 'silent' },
    { spec: spec, clock: clock }
  ).ready()
  expect(si).exists()

  si.message('a:1', async function (m) {
    if (3 === m.x) this.fail('bad', {})
    return { x: m.x }
  })

  await si.post('sys:msg-run,cmd:start')
  await si.ready()

  var status0 = await si.post('sys:msg-run,get:status')
  //console.log('status0', status0)
  expect(status0).contains({ running: true, runs: 1 })

  var current0 = await si.post('sys:msg-run,get:current')
  //console.log('current0')
  //console.dir(current0,{depth:5})
  expect(current0.tests[0].pass).equals(true)
})

/*
async function sleep(time) {
  return new Promise(resolve=>setTimeout(resolve,time))
}
*/

function seneca_instance(seneca_options, plugin_options) {
  return Seneca(seneca_options, { legacy: { transport: false } })
    .test()
    .use('promisify')
    .use('entity')
    .use(Plugin, plugin_options)
}
