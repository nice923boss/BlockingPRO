# vendor

編輯器、render.html（check_scene.py）用到的瀏覽器函式庫，放在本機以便離線使用（s01）。內容從 jsDelivr（npm 套件原檔）下載，沒有修改。

| 資料夾 | 套件與版本 | 來源 | 授權 |
|---|---|---|---|
| `three/` | three 0.186.1 | `https://cdn.jsdelivr.net/npm/three@0.186.1/` | MIT（`three/LICENSE`） |
| `mediabunny/` | mediabunny 1.61.0 | `.../npm/mediabunny@1.61.0/dist/bundles/mediabunny.min.mjs` | MPL-2.0（`mediabunny/LICENSE`） |
| `gifenc/` | gifenc 1.0.3 | `.../npm/gifenc@1.0.3/dist/gifenc.esm.js` | MIT（`gifenc/LICENSE.md`） |

three 只放用到的檔案，路徑和套件裡相同（附加元件之間用相對路徑互相 import）：

- `build/three.module.js`、`build/three.core.js`
- `examples/jsm/controls/OrbitControls.js`、`TransformControls.js`
- `examples/jsm/renderers/CSS2DRenderer.js`
- `examples/jsm/loaders/GLTFLoader.js`、`OBJLoader.js`、`DRACOLoader.js`
- `examples/jsm/libs/meshopt_decoder.module.js`、`libs/draco/gltf/draco_wasm_wrapper.js`、`draco_decoder.wasm`
- `examples/jsm/utils/SkeletonUtils.js`、`BufferGeometryUtils.js`（GLTFLoader 用到）

程式新增 `three/addons/...` 的 import 時，要把那個檔案（和它相對 import 的檔案）一起下載到同樣的路徑，否則離線時載不到。升級版本時依上表的來源重新下載同樣的檔案，並更新上表、`runtime/export.js` 與 `js/export-extra.js` 的版本註解。
