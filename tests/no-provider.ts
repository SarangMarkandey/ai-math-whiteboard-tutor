// Safety net: automated tests must never perform real speech requests.
import {beforeAll} from 'vitest';
beforeAll(()=>{globalThis.fetch=async()=>{throw new Error('Network disabled in unit tests. Inject a mock fetcher.');};});
