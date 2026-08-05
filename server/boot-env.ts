// Load .env BEFORE anything reads it. Import this first, above every other
// import, in each entry point.
//
// This exists because of a bug that cost an evening. `loadEnv()` used to be a
// call in the entry point's body:
//
//     import { loadEnv } from './env'
//     import { startHub } from './hub'     // → weather → config
//     loadEnv()                            // ...runs AFTER all of the above
//
// ES modules evaluate every import before a single statement of the importing
// module's body, so `config.ts` — which reads process.env at module scope to
// build its constants — had already frozen every one of them from an
// environment that did not yet have the .env in it. Values with a default
// carried on quietly using the default, which is why nobody noticed until a
// a weather API key sitting correctly in .env produced "no key, using the fallback"
// and the weather tab kept drawing the old source.
//
// A side-effect import fixes it properly: it is an import, so it is evaluated
// in import order, and putting it first means process.env is populated before
// any config module gets to look at it.
import { loadEnv } from './env'

loadEnv()
