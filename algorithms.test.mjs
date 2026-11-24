import test from 'node:test';
import assert from 'node:assert/strict';
import {selfTests} from './self-tests.js';
for (const r of selfTests()) test(r.name,()=>assert.equal(r.ok,true,r.error));
