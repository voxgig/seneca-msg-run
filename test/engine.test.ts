import * as Lab from '@hapi/lab'
import { expect } from '@hapi/code'

import foo from '../dist/engine'

const lab = Lab.script()
const { describe, it, before } = lab
export { lab }


describe('engine', () => {

    before(() => {})

    it('foo', () => {
      expect(foo(1)).to.equal(2)
    })
})
