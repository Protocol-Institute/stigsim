import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import wasmLocation from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { newVariant } from 'quickjs-emscripten-core';

// Let Vite resolve/copy the binary in dev, Worker bundles and base-path builds.
// Emscripten's relative filename points into .vite/deps after prebundling.
export default newVariant(RELEASE_SYNC, { wasmLocation });
