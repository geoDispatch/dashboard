import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// No solid plugin and no jsdom: every module under test is plain JavaScript
// over solid-js primitives, so the suite runs in node in well under a second
// and cannot pass or fail for reasons to do with a fake DOM.
//
// The two options below are load-bearing, and the suite is worthless without
// them. solid-js ships a real reactive build and an SSR stub, and its `node`
// export condition points at the stub — where createMemo never recomputes and
// a store write notifies nothing. Resolved that way every derivation test
// passes against stale values and proves the opposite of what it claims.
//
//   conditions   pick the browser build for the test files themselves
//   inline       transform solid-js and solid-js/store instead of letting node
//                require them, so the SAME choice is applied to the import
//                solid-js/store makes of solid-js. Without this the store and
//                the tests end up holding two different reactive graphs, the
//                writes land in one and the memos live in the other, and
//                nothing appears to update at all.
// fileURLToPath, not URL.pathname: this repository lives under a directory
// with a space in its name and pathname hands back the percent-encoded form.
const solid = fileURLToPath(new URL('./node_modules/solid-js/', import.meta.url))

export default defineConfig({
  resolve: {
    conditions: ['browser', 'development'],
    // Conditions alone are not enough. In a node environment the resolver
    // still reaches solid-js through node's own algorithm, which honours the
    // `node` condition and lands on the stub. Naming the files removes the
    // question. Order matters: the bare 'solid-js' entry is a prefix of the
    // others and must come last.
    alias: {
      'solid-js/store': `${solid}store/dist/store.js`,
      'solid-js': `${solid}dist/solid.js`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    server: {
      deps: {
        inline: [/solid-js/],
      },
    },
  },
})
