var THREE_ADDONS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) =>
    typeof require !== 'undefined'
      ? require
      : typeof Proxy !== 'undefined'
        ? new Proxy(x, {
            get: (a, b) => (typeof require !== 'undefined' ? require : a)[b],
          })
        : x)(function (x) {
    if (typeof require !== 'undefined') return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if ((from && typeof from === 'object') || typeof from === 'function') {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, {
            get: () => from[key],
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
          });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod);

  // node_modules/three/examples/jsm/loaders/GLTFLoader.js
  var GLTFLoader_exports = {};
  __export(GLTFLoader_exports, {
    GLTFLoader: () => GLTFLoader,
  });
  var import_three2 = __require('three');

  // node_modules/three/examples/jsm/utils/BufferGeometryUtils.js
  var import_three = __require('three');
  /**
   * toTrianglesDrawMode
   * @param {*} geometry
   * @param {*} drawMode
   * @returns {*}
   */
  function toTrianglesDrawMode(geometry, drawMode) {
    if (drawMode === import_three.TrianglesDrawMode) {
      console.warn('THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles.');
      return geometry;
    }
    if (drawMode === import_three.TriangleFanDrawMode || drawMode === import_three.TriangleStripDrawMode) {
      let index = geometry.getIndex();
      if (index === null) {
        const indices = [];
        const position = geometry.getAttribute('position');
        if (position !== void 0) {
          for (let i = 0; i < position.count; i++) {
            indices.push(i);
          }
          geometry.setIndex(indices);
          index = geometry.getIndex();
        } else {
          console.error(
            'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible.'
          );
          return geometry;
        }
      }
      const numberOfTriangles = index.count - 2;
      const newIndices = [];
      if (drawMode === import_three.TriangleFanDrawMode) {
        for (let i = 1; i <= numberOfTriangles; i++) {
          newIndices.push(index.getX(0));
          newIndices.push(index.getX(i));
          newIndices.push(index.getX(i + 1));
        }
      } else {
        for (let i = 0; i < numberOfTriangles; i++) {
          if (i % 2 === 0) {
            newIndices.push(index.getX(i));
            newIndices.push(index.getX(i + 1));
            newIndices.push(index.getX(i + 2));
          } else {
            newIndices.push(index.getX(i + 2));
            newIndices.push(index.getX(i + 1));
            newIndices.push(index.getX(i));
          }
        }
      }
      if (newIndices.length / 3 !== numberOfTriangles) {
        console.error(
          'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.'
        );
      }
      const newGeometry = geometry.clone();
      newGeometry.setIndex(newIndices);
      newGeometry.clearGroups();
      return newGeometry;
    } else {
      console.error('THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:', drawMode);
      return geometry;
    }
  }

  // node_modules/three/examples/jsm/loaders/GLTFLoader.js
  var GLTFLoader = class extends import_three2.Loader {
    constructor(manager) {
      super(manager);
      this.dracoLoader = null;
      this.ktx2Loader = null;
      this.meshoptDecoder = null;
      this.pluginCallbacks = [];
      this.register(function (parser) {
        return new GLTFMaterialsClearcoatExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFTextureBasisUExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFTextureWebPExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFTextureAVIFExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsSheenExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsTransmissionExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsVolumeExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsIorExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsEmissiveStrengthExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsSpecularExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsIridescenceExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsAnisotropyExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMaterialsBumpExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFLightsExtension(parser);
      });
      this.register(function (parser) {
        return new GLTFMeshoptCompression(parser);
      });
      this.register(function (parser) {
        return new GLTFMeshGpuInstancing(parser);
      });
    }
    load(url, onLoad, onProgress, onError) {
      const scope = this;
      let resourcePath;
      if (this.resourcePath !== '') {
        resourcePath = this.resourcePath;
      } else if (this.path !== '') {
        const relativeUrl = import_three2.LoaderUtils.extractUrlBase(url);
        resourcePath = import_three2.LoaderUtils.resolveURL(relativeUrl, this.path);
      } else {
        resourcePath = import_three2.LoaderUtils.extractUrlBase(url);
      }
      this.manager.itemStart(url);
      const _onError = function (e) {
        if (onError) {
          onError(e);
        } else {
          console.error(e);
        }
        scope.manager.itemError(url);
        scope.manager.itemEnd(url);
      };
      const loader = new import_three2.FileLoader(this.manager);
      loader.setPath(this.path);
      loader.setResponseType('arraybuffer');
      loader.setRequestHeader(this.requestHeader);
      loader.setWithCredentials(this.withCredentials);
      loader.load(
        url,
        function (data) {
          try {
            scope.parse(
              data,
              resourcePath,
              function (gltf) {
                onLoad(gltf);
                scope.manager.itemEnd(url);
              },
              _onError
            );
          } catch (e) {
            _onError(e);
          }
        },
        onProgress,
        _onError
      );
    }
    setDRACOLoader(dracoLoader) {
      this.dracoLoader = dracoLoader;
      return this;
    }
    setDDSLoader() {
      throw new Error(
        'THREE.GLTFLoader: "MSFT_texture_dds" no longer supported. Please update to "KHR_texture_basisu".'
      );
    }
    setKTX2Loader(ktx2Loader) {
      this.ktx2Loader = ktx2Loader;
      return this;
    }
    setMeshoptDecoder(meshoptDecoder) {
      this.meshoptDecoder = meshoptDecoder;
      return this;
    }
    register(callback) {
      if (this.pluginCallbacks.indexOf(callback) === -1) {
        this.pluginCallbacks.push(callback);
      }
      return this;
    }
    unregister(callback) {
      if (this.pluginCallbacks.indexOf(callback) !== -1) {
        this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(callback), 1);
      }
      return this;
    }
    parse(data, path, onLoad, onError) {
      let json;
      const extensions = {};
      const plugins = {};
      const textDecoder = new TextDecoder();
      if (typeof data === 'string') {
        try {
          json = JSON.parse(data);
        } catch (error) {
          if (onError) onError(error);
          return;
        }
      } else if (data instanceof ArrayBuffer) {
        const magic = textDecoder.decode(new Uint8Array(data, 0, 4));
        if (magic === BINARY_EXTENSION_HEADER_MAGIC) {
          try {
            extensions[EXTENSIONS.KHR_BINARY_GLTF] = new GLTFBinaryExtension(data);
          } catch (error) {
            if (onError) onError(error);
            return;
          }
          try {
            json = JSON.parse(extensions[EXTENSIONS.KHR_BINARY_GLTF].content);
          } catch (error) {
            if (onError) onError(error);
            return;
          }
        } else {
          try {
            json = JSON.parse(textDecoder.decode(data));
          } catch (error) {
            if (onError) onError(error);
            return;
          }
        }
      } else {
        json = data;
      }
      if (json.asset === void 0 || json.asset.version[0] < 2) {
        if (onError) onError(new Error('THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported.'));
        return;
      }
      const parser = new GLTFParser(json, {
        path: path || this.resourcePath || '',
        crossOrigin: this.crossOrigin,
        requestHeader: this.requestHeader,
        manager: this.manager,
        ktx2Loader: this.ktx2Loader,
        meshoptDecoder: this.meshoptDecoder,
      });
      parser.fileLoader.setRequestHeader(this.requestHeader);
      for (let i = 0; i < this.pluginCallbacks.length; i++) {
        const plugin = this.pluginCallbacks[i](parser);
        if (!plugin.name) console.error('THREE.GLTFLoader: Invalid plugin found: missing name');
        plugins[plugin.name] = plugin;
        extensions[plugin.name] = true;
      }
      if (json.extensionsUsed) {
        for (let i = 0; i < json.extensionsUsed.length; ++i) {
          const extensionName = json.extensionsUsed[i];
          const extensionsRequired = json.extensionsRequired || [];
          switch (extensionName) {
            case EXTENSIONS.KHR_MATERIALS_UNLIT:
              extensions[extensionName] = new GLTFMaterialsUnlitExtension();
              break;
            case EXTENSIONS.KHR_DRACO_MESH_COMPRESSION:
              extensions[extensionName] = new GLTFDracoMeshCompressionExtension(json, this.dracoLoader);
              break;
            case EXTENSIONS.KHR_TEXTURE_TRANSFORM:
              extensions[extensionName] = new GLTFTextureTransformExtension();
              break;
            case EXTENSIONS.KHR_MESH_QUANTIZATION:
              extensions[extensionName] = new GLTFMeshQuantizationExtension();
              break;
            default:
              if (extensionsRequired.indexOf(extensionName) >= 0 && plugins[extensionName] === void 0) {
                console.warn('THREE.GLTFLoader: Unknown extension "' + extensionName + '".');
              }
          }
        }
      }
      parser.setExtensions(extensions);
      parser.setPlugins(plugins);
      parser.parse(onLoad, onError);
    }
    parseAsync(data, path) {
      const scope = this;
      return new Promise(function (resolve, reject) {
        scope.parse(data, path, resolve, reject);
      });
    }
  };
  /**
   * GLTFRegistry
   * @returns {*}
   */
  function GLTFRegistry() {
    let objects = {};
    return {
      get: function (key) {
        return objects[key];
      },
      add: function (key, object) {
        objects[key] = object;
      },
      remove: function (key) {
        delete objects[key];
      },
      removeAll: function () {
        objects = {};
      },
    };
  }
  var EXTENSIONS = {
    KHR_BINARY_GLTF: 'KHR_binary_glTF',
    KHR_DRACO_MESH_COMPRESSION: 'KHR_draco_mesh_compression',
    KHR_LIGHTS_PUNCTUAL: 'KHR_lights_punctual',
    KHR_MATERIALS_CLEARCOAT: 'KHR_materials_clearcoat',
    KHR_MATERIALS_IOR: 'KHR_materials_ior',
    KHR_MATERIALS_SHEEN: 'KHR_materials_sheen',
    KHR_MATERIALS_SPECULAR: 'KHR_materials_specular',
    KHR_MATERIALS_TRANSMISSION: 'KHR_materials_transmission',
    KHR_MATERIALS_IRIDESCENCE: 'KHR_materials_iridescence',
    KHR_MATERIALS_ANISOTROPY: 'KHR_materials_anisotropy',
    KHR_MATERIALS_UNLIT: 'KHR_materials_unlit',
    KHR_MATERIALS_VOLUME: 'KHR_materials_volume',
    KHR_TEXTURE_BASISU: 'KHR_texture_basisu',
    KHR_TEXTURE_TRANSFORM: 'KHR_texture_transform',
    KHR_MESH_QUANTIZATION: 'KHR_mesh_quantization',
    KHR_MATERIALS_EMISSIVE_STRENGTH: 'KHR_materials_emissive_strength',
    EXT_MATERIALS_BUMP: 'EXT_materials_bump',
    EXT_TEXTURE_WEBP: 'EXT_texture_webp',
    EXT_TEXTURE_AVIF: 'EXT_texture_avif',
    EXT_MESHOPT_COMPRESSION: 'EXT_meshopt_compression',
    EXT_MESH_GPU_INSTANCING: 'EXT_mesh_gpu_instancing',
  };
  var GLTFLightsExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_LIGHTS_PUNCTUAL;
      this.cache = { refs: {}, uses: {} };
    }
    _markDefs() {
      const parser = this.parser;
      const nodeDefs = this.parser.json.nodes || [];
      for (let nodeIndex = 0, nodeLength = nodeDefs.length; nodeIndex < nodeLength; nodeIndex++) {
        const nodeDef = nodeDefs[nodeIndex];
        if (nodeDef.extensions && nodeDef.extensions[this.name] && nodeDef.extensions[this.name].light !== void 0) {
          parser._addNodeRef(this.cache, nodeDef.extensions[this.name].light);
        }
      }
    }
    _loadLight(lightIndex) {
      const parser = this.parser;
      const cacheKey = 'light:' + lightIndex;
      let dependency = parser.cache.get(cacheKey);
      if (dependency) return dependency;
      const json = parser.json;
      const extensions = (json.extensions && json.extensions[this.name]) || {};
      const lightDefs = extensions.lights || [];
      const lightDef = lightDefs[lightIndex];
      let lightNode;
      const color = new import_three2.Color(16777215);
      if (lightDef.color !== void 0)
        color.setRGB(lightDef.color[0], lightDef.color[1], lightDef.color[2], import_three2.LinearSRGBColorSpace);
      const range = lightDef.range !== void 0 ? lightDef.range : 0;
      switch (lightDef.type) {
        case 'directional':
          lightNode = new import_three2.DirectionalLight(color);
          lightNode.target.position.set(0, 0, -1);
          lightNode.add(lightNode.target);
          break;
        case 'point':
          lightNode = new import_three2.PointLight(color);
          lightNode.distance = range;
          break;
        case 'spot':
          lightNode = new import_three2.SpotLight(color);
          lightNode.distance = range;
          lightDef.spot = lightDef.spot || {};
          lightDef.spot.innerConeAngle = lightDef.spot.innerConeAngle !== void 0 ? lightDef.spot.innerConeAngle : 0;
          lightDef.spot.outerConeAngle =
            lightDef.spot.outerConeAngle !== void 0 ? lightDef.spot.outerConeAngle : Math.PI / 4;
          lightNode.angle = lightDef.spot.outerConeAngle;
          lightNode.penumbra = 1 - lightDef.spot.innerConeAngle / lightDef.spot.outerConeAngle;
          lightNode.target.position.set(0, 0, -1);
          lightNode.add(lightNode.target);
          break;
        default:
          throw new Error('THREE.GLTFLoader: Unexpected light type: ' + lightDef.type);
      }
      lightNode.position.set(0, 0, 0);
      lightNode.decay = 2;
      assignExtrasToUserData(lightNode, lightDef);
      if (lightDef.intensity !== void 0) lightNode.intensity = lightDef.intensity;
      lightNode.name = parser.createUniqueName(lightDef.name || 'light_' + lightIndex);
      dependency = Promise.resolve(lightNode);
      parser.cache.add(cacheKey, dependency);
      return dependency;
    }
    getDependency(type, index) {
      if (type !== 'light') return;
      return this._loadLight(index);
    }
    createNodeAttachment(nodeIndex) {
      const self2 = this;
      const parser = this.parser;
      const json = parser.json;
      const nodeDef = json.nodes[nodeIndex];
      const lightDef = (nodeDef.extensions && nodeDef.extensions[this.name]) || {};
      const lightIndex = lightDef.light;
      if (lightIndex === void 0) return null;
      return this._loadLight(lightIndex).then(function (light) {
        return parser._getNodeRef(self2.cache, lightIndex, light);
      });
    }
  };
  var GLTFMaterialsUnlitExtension = class {
    constructor() {
      this.name = EXTENSIONS.KHR_MATERIALS_UNLIT;
    }
    getMaterialType() {
      return import_three2.MeshBasicMaterial;
    }
    extendParams(materialParams, materialDef, parser) {
      const pending = [];
      materialParams.color = new import_three2.Color(1, 1, 1);
      materialParams.opacity = 1;
      const metallicRoughness = materialDef.pbrMetallicRoughness;
      if (metallicRoughness) {
        if (Array.isArray(metallicRoughness.baseColorFactor)) {
          const array = metallicRoughness.baseColorFactor;
          materialParams.color.setRGB(array[0], array[1], array[2], import_three2.LinearSRGBColorSpace);
          materialParams.opacity = array[3];
        }
        if (metallicRoughness.baseColorTexture !== void 0) {
          pending.push(
            parser.assignTexture(
              materialParams,
              'map',
              metallicRoughness.baseColorTexture,
              import_three2.SRGBColorSpace
            )
          );
        }
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsEmissiveStrengthExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_EMISSIVE_STRENGTH;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const emissiveStrength = materialDef.extensions[this.name].emissiveStrength;
      if (emissiveStrength !== void 0) {
        materialParams.emissiveIntensity = emissiveStrength;
      }
      return Promise.resolve();
    }
  };
  var GLTFMaterialsClearcoatExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_CLEARCOAT;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      if (extension.clearcoatFactor !== void 0) {
        materialParams.clearcoat = extension.clearcoatFactor;
      }
      if (extension.clearcoatTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'clearcoatMap', extension.clearcoatTexture));
      }
      if (extension.clearcoatRoughnessFactor !== void 0) {
        materialParams.clearcoatRoughness = extension.clearcoatRoughnessFactor;
      }
      if (extension.clearcoatRoughnessTexture !== void 0) {
        pending.push(
          parser.assignTexture(materialParams, 'clearcoatRoughnessMap', extension.clearcoatRoughnessTexture)
        );
      }
      if (extension.clearcoatNormalTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'clearcoatNormalMap', extension.clearcoatNormalTexture));
        if (extension.clearcoatNormalTexture.scale !== void 0) {
          const scale = extension.clearcoatNormalTexture.scale;
          materialParams.clearcoatNormalScale = new import_three2.Vector2(scale, scale);
        }
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsIridescenceExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_IRIDESCENCE;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      if (extension.iridescenceFactor !== void 0) {
        materialParams.iridescence = extension.iridescenceFactor;
      }
      if (extension.iridescenceTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'iridescenceMap', extension.iridescenceTexture));
      }
      if (extension.iridescenceIor !== void 0) {
        materialParams.iridescenceIOR = extension.iridescenceIor;
      }
      if (materialParams.iridescenceThicknessRange === void 0) {
        materialParams.iridescenceThicknessRange = [100, 400];
      }
      if (extension.iridescenceThicknessMinimum !== void 0) {
        materialParams.iridescenceThicknessRange[0] = extension.iridescenceThicknessMinimum;
      }
      if (extension.iridescenceThicknessMaximum !== void 0) {
        materialParams.iridescenceThicknessRange[1] = extension.iridescenceThicknessMaximum;
      }
      if (extension.iridescenceThicknessTexture !== void 0) {
        pending.push(
          parser.assignTexture(materialParams, 'iridescenceThicknessMap', extension.iridescenceThicknessTexture)
        );
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsSheenExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_SHEEN;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      materialParams.sheenColor = new import_three2.Color(0, 0, 0);
      materialParams.sheenRoughness = 0;
      materialParams.sheen = 1;
      const extension = materialDef.extensions[this.name];
      if (extension.sheenColorFactor !== void 0) {
        const colorFactor = extension.sheenColorFactor;
        materialParams.sheenColor.setRGB(
          colorFactor[0],
          colorFactor[1],
          colorFactor[2],
          import_three2.LinearSRGBColorSpace
        );
      }
      if (extension.sheenRoughnessFactor !== void 0) {
        materialParams.sheenRoughness = extension.sheenRoughnessFactor;
      }
      if (extension.sheenColorTexture !== void 0) {
        pending.push(
          parser.assignTexture(
            materialParams,
            'sheenColorMap',
            extension.sheenColorTexture,
            import_three2.SRGBColorSpace
          )
        );
      }
      if (extension.sheenRoughnessTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'sheenRoughnessMap', extension.sheenRoughnessTexture));
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsTransmissionExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_TRANSMISSION;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      if (extension.transmissionFactor !== void 0) {
        materialParams.transmission = extension.transmissionFactor;
      }
      if (extension.transmissionTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'transmissionMap', extension.transmissionTexture));
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsVolumeExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_VOLUME;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      materialParams.thickness = extension.thicknessFactor !== void 0 ? extension.thicknessFactor : 0;
      if (extension.thicknessTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'thicknessMap', extension.thicknessTexture));
      }
      materialParams.attenuationDistance = extension.attenuationDistance || Infinity;
      const colorArray = extension.attenuationColor || [1, 1, 1];
      materialParams.attenuationColor = new import_three2.Color().setRGB(
        colorArray[0],
        colorArray[1],
        colorArray[2],
        import_three2.LinearSRGBColorSpace
      );
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsIorExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_IOR;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const extension = materialDef.extensions[this.name];
      materialParams.ior = extension.ior !== void 0 ? extension.ior : 1.5;
      return Promise.resolve();
    }
  };
  var GLTFMaterialsSpecularExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_SPECULAR;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      materialParams.specularIntensity = extension.specularFactor !== void 0 ? extension.specularFactor : 1;
      if (extension.specularTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'specularIntensityMap', extension.specularTexture));
      }
      const colorArray = extension.specularColorFactor || [1, 1, 1];
      materialParams.specularColor = new import_three2.Color().setRGB(
        colorArray[0],
        colorArray[1],
        colorArray[2],
        import_three2.LinearSRGBColorSpace
      );
      if (extension.specularColorTexture !== void 0) {
        pending.push(
          parser.assignTexture(
            materialParams,
            'specularColorMap',
            extension.specularColorTexture,
            import_three2.SRGBColorSpace
          )
        );
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsBumpExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.EXT_MATERIALS_BUMP;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      materialParams.bumpScale = extension.bumpFactor !== void 0 ? extension.bumpFactor : 1;
      if (extension.bumpTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'bumpMap', extension.bumpTexture));
      }
      return Promise.all(pending);
    }
  };
  var GLTFMaterialsAnisotropyExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_MATERIALS_ANISOTROPY;
    }
    getMaterialType(materialIndex) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
      return import_three2.MeshPhysicalMaterial;
    }
    extendMaterialParams(materialIndex, materialParams) {
      const parser = this.parser;
      const materialDef = parser.json.materials[materialIndex];
      if (!materialDef.extensions || !materialDef.extensions[this.name]) {
        return Promise.resolve();
      }
      const pending = [];
      const extension = materialDef.extensions[this.name];
      if (extension.anisotropyStrength !== void 0) {
        materialParams.anisotropy = extension.anisotropyStrength;
      }
      if (extension.anisotropyRotation !== void 0) {
        materialParams.anisotropyRotation = extension.anisotropyRotation;
      }
      if (extension.anisotropyTexture !== void 0) {
        pending.push(parser.assignTexture(materialParams, 'anisotropyMap', extension.anisotropyTexture));
      }
      return Promise.all(pending);
    }
  };
  var GLTFTextureBasisUExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.KHR_TEXTURE_BASISU;
    }
    loadTexture(textureIndex) {
      const parser = this.parser;
      const json = parser.json;
      const textureDef = json.textures[textureIndex];
      if (!textureDef.extensions || !textureDef.extensions[this.name]) {
        return null;
      }
      const extension = textureDef.extensions[this.name];
      const loader = parser.options.ktx2Loader;
      if (!loader) {
        if (json.extensionsRequired && json.extensionsRequired.indexOf(this.name) >= 0) {
          throw new Error('THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures');
        } else {
          return null;
        }
      }
      return parser.loadTextureImage(textureIndex, extension.source, loader);
    }
  };
  var GLTFTextureWebPExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.EXT_TEXTURE_WEBP;
      this.isSupported = null;
    }
    loadTexture(textureIndex) {
      const name = this.name;
      const parser = this.parser;
      const json = parser.json;
      const textureDef = json.textures[textureIndex];
      if (!textureDef.extensions || !textureDef.extensions[name]) {
        return null;
      }
      const extension = textureDef.extensions[name];
      const source = json.images[extension.source];
      let loader = parser.textureLoader;
      if (source.uri) {
        const handler = parser.options.manager.getHandler(source.uri);
        if (handler !== null) loader = handler;
      }
      return this.detectSupport().then(function (isSupported) {
        if (isSupported) return parser.loadTextureImage(textureIndex, extension.source, loader);
        if (json.extensionsRequired && json.extensionsRequired.indexOf(name) >= 0) {
          throw new Error('THREE.GLTFLoader: WebP required by asset but unsupported.');
        }
        return parser.loadTexture(textureIndex);
      });
    }
    detectSupport() {
      if (!this.isSupported) {
        this.isSupported = new Promise(function (resolve) {
          const image = new Image();
          image.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
          image.onload = image.onerror = function () {
            resolve(image.height === 1);
          };
        });
      }
      return this.isSupported;
    }
  };
  var GLTFTextureAVIFExtension = class {
    constructor(parser) {
      this.parser = parser;
      this.name = EXTENSIONS.EXT_TEXTURE_AVIF;
      this.isSupported = null;
    }
    loadTexture(textureIndex) {
      const name = this.name;
      const parser = this.parser;
      const json = parser.json;
      const textureDef = json.textures[textureIndex];
      if (!textureDef.extensions || !textureDef.extensions[name]) {
        return null;
      }
      const extension = textureDef.extensions[name];
      const source = json.images[extension.source];
      let loader = parser.textureLoader;
      if (source.uri) {
        const handler = parser.options.manager.getHandler(source.uri);
        if (handler !== null) loader = handler;
      }
      return this.detectSupport().then(function (isSupported) {
        if (isSupported) return parser.loadTextureImage(textureIndex, extension.source, loader);
        if (json.extensionsRequired && json.extensionsRequired.indexOf(name) >= 0) {
          throw new Error('THREE.GLTFLoader: AVIF required by asset but unsupported.');
        }
        return parser.loadTexture(textureIndex);
      });
    }
    detectSupport() {
      if (!this.isSupported) {
        this.isSupported = new Promise(function (resolve) {
          const image = new Image();
          image.src =
            'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=';
          image.onload = image.onerror = function () {
            resolve(image.height === 1);
          };
        });
      }
      return this.isSupported;
    }
  };
  var GLTFMeshoptCompression = class {
    constructor(parser) {
      this.name = EXTENSIONS.EXT_MESHOPT_COMPRESSION;
      this.parser = parser;
    }
    loadBufferView(index) {
      const json = this.parser.json;
      const bufferView = json.bufferViews[index];
      if (bufferView.extensions && bufferView.extensions[this.name]) {
        const extensionDef = bufferView.extensions[this.name];
        const buffer = this.parser.getDependency('buffer', extensionDef.buffer);
        const decoder = this.parser.options.meshoptDecoder;
        if (!decoder || !decoder.supported) {
          if (json.extensionsRequired && json.extensionsRequired.indexOf(this.name) >= 0) {
            throw new Error('THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files');
          } else {
            return null;
          }
        }
        return buffer.then(function (res) {
          const byteOffset = extensionDef.byteOffset || 0;
          const byteLength = extensionDef.byteLength || 0;
          const count = extensionDef.count;
          const stride = extensionDef.byteStride;
          const source = new Uint8Array(res, byteOffset, byteLength);
          if (decoder.decodeGltfBufferAsync) {
            return decoder
              .decodeGltfBufferAsync(count, stride, source, extensionDef.mode, extensionDef.filter)
              .then(function (res2) {
                return res2.buffer;
              });
          } else {
            return decoder.ready.then(function () {
              const result = new ArrayBuffer(count * stride);
              decoder.decodeGltfBuffer(
                new Uint8Array(result),
                count,
                stride,
                source,
                extensionDef.mode,
                extensionDef.filter
              );
              return result;
            });
          }
        });
      } else {
        return null;
      }
    }
  };
  var GLTFMeshGpuInstancing = class {
    constructor(parser) {
      this.name = EXTENSIONS.EXT_MESH_GPU_INSTANCING;
      this.parser = parser;
    }
    createNodeMesh(nodeIndex) {
      const json = this.parser.json;
      const nodeDef = json.nodes[nodeIndex];
      if (!nodeDef.extensions || !nodeDef.extensions[this.name] || nodeDef.mesh === void 0) {
        return null;
      }
      const meshDef = json.meshes[nodeDef.mesh];
      for (const primitive of meshDef.primitives) {
        if (
          primitive.mode !== WEBGL_CONSTANTS.TRIANGLES &&
          primitive.mode !== WEBGL_CONSTANTS.TRIANGLE_STRIP &&
          primitive.mode !== WEBGL_CONSTANTS.TRIANGLE_FAN &&
          primitive.mode !== void 0
        ) {
          return null;
        }
      }
      const extensionDef = nodeDef.extensions[this.name];
      const attributesDef = extensionDef.attributes;
      const pending = [];
      const attributes = {};
      for (const key in attributesDef) {
        pending.push(
          this.parser.getDependency('accessor', attributesDef[key]).then((accessor) => {
            attributes[key] = accessor;
            return attributes[key];
          })
        );
      }
      if (pending.length < 1) {
        return null;
      }
      pending.push(this.parser.createNodeMesh(nodeIndex));
      return Promise.all(pending).then((results) => {
        const nodeObject = results.pop();
        const meshes = nodeObject.isGroup ? nodeObject.children : [nodeObject];
        const count = results[0].count;
        const instancedMeshes = [];
        for (const mesh of meshes) {
          const m = new import_three2.Matrix4();
          const p = new import_three2.Vector3();
          const q = new import_three2.Quaternion();
          const s = new import_three2.Vector3(1, 1, 1);
          const instancedMesh = new import_three2.InstancedMesh(mesh.geometry, mesh.material, count);
          for (let i = 0; i < count; i++) {
            if (attributes.TRANSLATION) {
              p.fromBufferAttribute(attributes.TRANSLATION, i);
            }
            if (attributes.ROTATION) {
              q.fromBufferAttribute(attributes.ROTATION, i);
            }
            if (attributes.SCALE) {
              s.fromBufferAttribute(attributes.SCALE, i);
            }
            instancedMesh.setMatrixAt(i, m.compose(p, q, s));
          }
          for (const attributeName in attributes) {
            if (attributeName === '_COLOR_0') {
              const attr = attributes[attributeName];
              instancedMesh.instanceColor = new import_three2.InstancedBufferAttribute(
                attr.array,
                attr.itemSize,
                attr.normalized
              );
            } else if (attributeName !== 'TRANSLATION' && attributeName !== 'ROTATION' && attributeName !== 'SCALE') {
              mesh.geometry.setAttribute(attributeName, attributes[attributeName]);
            }
          }
          import_three2.Object3D.prototype.copy.call(instancedMesh, mesh);
          this.parser.assignFinalMaterial(instancedMesh);
          instancedMeshes.push(instancedMesh);
        }
        if (nodeObject.isGroup) {
          nodeObject.clear();
          nodeObject.add(...instancedMeshes);
          return nodeObject;
        }
        return instancedMeshes[0];
      });
    }
  };
  var BINARY_EXTENSION_HEADER_MAGIC = 'glTF';
  var BINARY_EXTENSION_HEADER_LENGTH = 12;
  var BINARY_EXTENSION_CHUNK_TYPES = { JSON: 1313821514, BIN: 5130562 };
  var GLTFBinaryExtension = class {
    constructor(data) {
      this.name = EXTENSIONS.KHR_BINARY_GLTF;
      this.content = null;
      this.body = null;
      const headerView = new DataView(data, 0, BINARY_EXTENSION_HEADER_LENGTH);
      const textDecoder = new TextDecoder();
      this.header = {
        magic: textDecoder.decode(new Uint8Array(data.slice(0, 4))),
        version: headerView.getUint32(4, true),
        length: headerView.getUint32(8, true),
      };
      if (this.header.magic !== BINARY_EXTENSION_HEADER_MAGIC) {
        throw new Error('THREE.GLTFLoader: Unsupported glTF-Binary header.');
      } else if (this.header.version < 2) {
        throw new Error('THREE.GLTFLoader: Legacy binary file detected.');
      }
      const chunkContentsLength = this.header.length - BINARY_EXTENSION_HEADER_LENGTH;
      const chunkView = new DataView(data, BINARY_EXTENSION_HEADER_LENGTH);
      let chunkIndex = 0;
      while (chunkIndex < chunkContentsLength) {
        const chunkLength = chunkView.getUint32(chunkIndex, true);
        chunkIndex += 4;
        const chunkType = chunkView.getUint32(chunkIndex, true);
        chunkIndex += 4;
        if (chunkType === BINARY_EXTENSION_CHUNK_TYPES.JSON) {
          const contentArray = new Uint8Array(data, BINARY_EXTENSION_HEADER_LENGTH + chunkIndex, chunkLength);
          this.content = textDecoder.decode(contentArray);
        } else if (chunkType === BINARY_EXTENSION_CHUNK_TYPES.BIN) {
          const byteOffset = BINARY_EXTENSION_HEADER_LENGTH + chunkIndex;
          this.body = data.slice(byteOffset, byteOffset + chunkLength);
        }
        chunkIndex += chunkLength;
      }
      if (this.content === null) {
        throw new Error('THREE.GLTFLoader: JSON content not found.');
      }
    }
  };
  var GLTFDracoMeshCompressionExtension = class {
    constructor(json, dracoLoader) {
      if (!dracoLoader) {
        throw new Error('THREE.GLTFLoader: No DRACOLoader instance provided.');
      }
      this.name = EXTENSIONS.KHR_DRACO_MESH_COMPRESSION;
      this.json = json;
      this.dracoLoader = dracoLoader;
      this.dracoLoader.preload();
    }
    decodePrimitive(primitive, parser) {
      const json = this.json;
      const dracoLoader = this.dracoLoader;
      const bufferViewIndex = primitive.extensions[this.name].bufferView;
      const gltfAttributeMap = primitive.extensions[this.name].attributes;
      const threeAttributeMap = {};
      const attributeNormalizedMap = {};
      const attributeTypeMap = {};
      for (const attributeName in gltfAttributeMap) {
        const threeAttributeName = ATTRIBUTES[attributeName] || attributeName.toLowerCase();
        threeAttributeMap[threeAttributeName] = gltfAttributeMap[attributeName];
      }
      for (const attributeName in primitive.attributes) {
        const threeAttributeName = ATTRIBUTES[attributeName] || attributeName.toLowerCase();
        if (gltfAttributeMap[attributeName] !== void 0) {
          const accessorDef = json.accessors[primitive.attributes[attributeName]];
          const componentType = WEBGL_COMPONENT_TYPES[accessorDef.componentType];
          attributeTypeMap[threeAttributeName] = componentType.name;
          attributeNormalizedMap[threeAttributeName] = accessorDef.normalized === true;
        }
      }
      return parser.getDependency('bufferView', bufferViewIndex).then(function (bufferView) {
        return new Promise(function (resolve, reject) {
          dracoLoader.decodeDracoFile(
            bufferView,
            function (geometry) {
              for (const attributeName in geometry.attributes) {
                const attribute = geometry.attributes[attributeName];
                const normalized = attributeNormalizedMap[attributeName];
                if (normalized !== void 0) attribute.normalized = normalized;
              }
              resolve(geometry);
            },
            threeAttributeMap,
            attributeTypeMap,
            import_three2.LinearSRGBColorSpace,
            reject
          );
        });
      });
    }
  };
  var GLTFTextureTransformExtension = class {
    constructor() {
      this.name = EXTENSIONS.KHR_TEXTURE_TRANSFORM;
    }
    extendTexture(texture, transform) {
      if (
        (transform.texCoord === void 0 || transform.texCoord === texture.channel) &&
        transform.offset === void 0 &&
        transform.rotation === void 0 &&
        transform.scale === void 0
      ) {
        return texture;
      }
      texture = texture.clone();
      if (transform.texCoord !== void 0) {
        texture.channel = transform.texCoord;
      }
      if (transform.offset !== void 0) {
        texture.offset.fromArray(transform.offset);
      }
      if (transform.rotation !== void 0) {
        texture.rotation = transform.rotation;
      }
      if (transform.scale !== void 0) {
        texture.repeat.fromArray(transform.scale);
      }
      texture.needsUpdate = true;
      return texture;
    }
  };
  var GLTFMeshQuantizationExtension = class {
    constructor() {
      this.name = EXTENSIONS.KHR_MESH_QUANTIZATION;
    }
  };
  var GLTFCubicSplineInterpolant = class extends import_three2.Interpolant {
    constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
      super(parameterPositions, sampleValues, sampleSize, resultBuffer);
    }
    copySampleValue_(index) {
      const result = this.resultBuffer,
        values = this.sampleValues,
        valueSize = this.valueSize,
        offset = index * valueSize * 3 + valueSize;
      for (let i = 0; i !== valueSize; i++) {
        result[i] = values[offset + i];
      }
      return result;
    }
    interpolate_(i1, t0, t, t1) {
      const result = this.resultBuffer;
      const values = this.sampleValues;
      const stride = this.valueSize;
      const stride2 = stride * 2;
      const stride3 = stride * 3;
      const td = t1 - t0;
      const p = (t - t0) / td;
      const pp = p * p;
      const ppp = pp * p;
      const offset1 = i1 * stride3;
      const offset0 = offset1 - stride3;
      const s2 = -2 * ppp + 3 * pp;
      const s3 = ppp - pp;
      const s0 = 1 - s2;
      const s1 = s3 - pp + p;
      for (let i = 0; i !== stride; i++) {
        const p0 = values[offset0 + i + stride];
        const m0 = values[offset0 + i + stride2] * td;
        const p1 = values[offset1 + i + stride];
        const m1 = values[offset1 + i] * td;
        result[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;
      }
      return result;
    }
  };
  var _q = new import_three2.Quaternion();
  var GLTFCubicSplineQuaternionInterpolant = class extends GLTFCubicSplineInterpolant {
    interpolate_(i1, t0, t, t1) {
      const result = super.interpolate_(i1, t0, t, t1);
      _q.fromArray(result).normalize().toArray(result);
      return result;
    }
  };
  var WEBGL_CONSTANTS = {
    FLOAT: 5126,
    //FLOAT_MAT2: 35674,
    FLOAT_MAT3: 35675,
    FLOAT_MAT4: 35676,
    FLOAT_VEC2: 35664,
    FLOAT_VEC3: 35665,
    FLOAT_VEC4: 35666,
    LINEAR: 9729,
    REPEAT: 10497,
    SAMPLER_2D: 35678,
    POINTS: 0,
    LINES: 1,
    LINE_LOOP: 2,
    LINE_STRIP: 3,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TRIANGLE_FAN: 6,
    UNSIGNED_BYTE: 5121,
    UNSIGNED_SHORT: 5123,
  };
  var WEBGL_COMPONENT_TYPES = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  };
  var WEBGL_FILTERS = {
    9728: import_three2.NearestFilter,
    9729: import_three2.LinearFilter,
    9984: import_three2.NearestMipmapNearestFilter,
    9985: import_three2.LinearMipmapNearestFilter,
    9986: import_three2.NearestMipmapLinearFilter,
    9987: import_three2.LinearMipmapLinearFilter,
  };
  var WEBGL_WRAPPINGS = {
    33071: import_three2.ClampToEdgeWrapping,
    33648: import_three2.MirroredRepeatWrapping,
    10497: import_three2.RepeatWrapping,
  };
  var WEBGL_TYPE_SIZES = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
  };
  var ATTRIBUTES = {
    POSITION: 'position',
    NORMAL: 'normal',
    TANGENT: 'tangent',
    TEXCOORD_0: 'uv',
    TEXCOORD_1: 'uv1',
    TEXCOORD_2: 'uv2',
    TEXCOORD_3: 'uv3',
    COLOR_0: 'color',
    WEIGHTS_0: 'skinWeight',
    JOINTS_0: 'skinIndex',
  };
  var PATH_PROPERTIES = {
    scale: 'scale',
    translation: 'position',
    rotation: 'quaternion',
    weights: 'morphTargetInfluences',
  };
  var INTERPOLATION = {
    CUBICSPLINE: void 0,
    // We use a custom interpolant (GLTFCubicSplineInterpolation) for CUBICSPLINE tracks. Each
    // keyframe track will be initialized with a default interpolation type, then modified.
    LINEAR: import_three2.InterpolateLinear,
    STEP: import_three2.InterpolateDiscrete,
  };
  var ALPHA_MODES = {
    OPAQUE: 'OPAQUE',
    MASK: 'MASK',
    BLEND: 'BLEND',
  };
  /**
   * createDefaultMaterial
   * @param {*} cache
   * @returns {*}
   */
  function createDefaultMaterial(cache) {
    if (cache['DefaultMaterial'] === void 0) {
      cache['DefaultMaterial'] = new import_three2.MeshStandardMaterial({
        color: 16777215,
        emissive: 0,
        metalness: 1,
        roughness: 1,
        transparent: false,
        depthTest: true,
        side: import_three2.FrontSide,
      });
    }
    return cache['DefaultMaterial'];
  }
  /**
   * addUnknownExtensionsToUserData
   * @param {*} knownExtensions
   * @param {*} object
   * @param {*} objectDef
   * @returns {*}
   */
  function addUnknownExtensionsToUserData(knownExtensions, object, objectDef) {
    for (const name in objectDef.extensions) {
      if (knownExtensions[name] === void 0) {
        object.userData.gltfExtensions = object.userData.gltfExtensions || {};
        object.userData.gltfExtensions[name] = objectDef.extensions[name];
      }
    }
  }
  /**
   * assignExtrasToUserData
   * @param {*} object
   * @param {*} gltfDef
   * @returns {*}
   */
  function assignExtrasToUserData(object, gltfDef) {
    if (gltfDef.extras !== void 0) {
      if (typeof gltfDef.extras === 'object') {
        Object.assign(object.userData, gltfDef.extras);
      } else {
        console.warn('THREE.GLTFLoader: Ignoring primitive type .extras, ' + gltfDef.extras);
      }
    }
  }
  /**
   * addMorphTargets
   * @param {*} geometry
   * @param {*} targets
   * @param {*} parser
   * @returns {*}
   */
  function addMorphTargets(geometry, targets, parser) {
    let hasMorphPosition = false;
    let hasMorphNormal = false;
    let hasMorphColor = false;
    for (let i = 0, il = targets.length; i < il; i++) {
      const target = targets[i];
      if (target.POSITION !== void 0) hasMorphPosition = true;
      if (target.NORMAL !== void 0) hasMorphNormal = true;
      if (target.COLOR_0 !== void 0) hasMorphColor = true;
      if (hasMorphPosition && hasMorphNormal && hasMorphColor) break;
    }
    if (!hasMorphPosition && !hasMorphNormal && !hasMorphColor) return Promise.resolve(geometry);
    const pendingPositionAccessors = [];
    const pendingNormalAccessors = [];
    const pendingColorAccessors = [];
    for (let i = 0, il = targets.length; i < il; i++) {
      const target = targets[i];
      if (hasMorphPosition) {
        const pendingAccessor =
          target.POSITION !== void 0 ? parser.getDependency('accessor', target.POSITION) : geometry.attributes.position;
        pendingPositionAccessors.push(pendingAccessor);
      }
      if (hasMorphNormal) {
        const pendingAccessor =
          target.NORMAL !== void 0 ? parser.getDependency('accessor', target.NORMAL) : geometry.attributes.normal;
        pendingNormalAccessors.push(pendingAccessor);
      }
      if (hasMorphColor) {
        const pendingAccessor =
          target.COLOR_0 !== void 0 ? parser.getDependency('accessor', target.COLOR_0) : geometry.attributes.color;
        pendingColorAccessors.push(pendingAccessor);
      }
    }
    return Promise.all([
      Promise.all(pendingPositionAccessors),
      Promise.all(pendingNormalAccessors),
      Promise.all(pendingColorAccessors),
    ]).then(function (accessors) {
      const morphPositions = accessors[0];
      const morphNormals = accessors[1];
      const morphColors = accessors[2];
      if (hasMorphPosition) geometry.morphAttributes.position = morphPositions;
      if (hasMorphNormal) geometry.morphAttributes.normal = morphNormals;
      if (hasMorphColor) geometry.morphAttributes.color = morphColors;
      geometry.morphTargetsRelative = true;
      return geometry;
    });
  }
  /**
   * updateMorphTargets
   * @param {*} mesh
   * @param {*} meshDef
   * @returns {*}
   */
  function updateMorphTargets(mesh, meshDef) {
    mesh.updateMorphTargets();
    if (meshDef.weights !== void 0) {
      for (let i = 0, il = meshDef.weights.length; i < il; i++) {
        mesh.morphTargetInfluences[i] = meshDef.weights[i];
      }
    }
    if (meshDef.extras && Array.isArray(meshDef.extras.targetNames)) {
      const targetNames = meshDef.extras.targetNames;
      if (mesh.morphTargetInfluences.length === targetNames.length) {
        mesh.morphTargetDictionary = {};
        for (let i = 0, il = targetNames.length; i < il; i++) {
          mesh.morphTargetDictionary[targetNames[i]] = i;
        }
      } else {
        console.warn('THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.');
      }
    }
  }
  /**
   * createPrimitiveKey
   * @param {*} primitiveDef
   * @returns {*}
   */
  function createPrimitiveKey(primitiveDef) {
    let geometryKey;
    const dracoExtension = primitiveDef.extensions && primitiveDef.extensions[EXTENSIONS.KHR_DRACO_MESH_COMPRESSION];
    if (dracoExtension) {
      geometryKey =
        'draco:' +
        dracoExtension.bufferView +
        ':' +
        dracoExtension.indices +
        ':' +
        createAttributesKey(dracoExtension.attributes);
    } else {
      geometryKey = primitiveDef.indices + ':' + createAttributesKey(primitiveDef.attributes) + ':' + primitiveDef.mode;
    }
    if (primitiveDef.targets !== void 0) {
      for (let i = 0, il = primitiveDef.targets.length; i < il; i++) {
        geometryKey += ':' + createAttributesKey(primitiveDef.targets[i]);
      }
    }
    return geometryKey;
  }
  /**
   * createAttributesKey
   * @param {*} attributes
   * @returns {*}
   */
  function createAttributesKey(attributes) {
    let attributesKey = '';
    const keys = Object.keys(attributes).sort();
    for (let i = 0, il = keys.length; i < il; i++) {
      attributesKey += keys[i] + ':' + attributes[keys[i]] + ';';
    }
    return attributesKey;
  }
  /**
   * getNormalizedComponentScale
   * @param {*} constructor
   * @returns {*}
   */
  function getNormalizedComponentScale(constructor) {
    switch (constructor) {
      case Int8Array:
        return 1 / 127;
      case Uint8Array:
        return 1 / 255;
      case Int16Array:
        return 1 / 32767;
      case Uint16Array:
        return 1 / 65535;
      default:
        throw new Error('THREE.GLTFLoader: Unsupported normalized accessor component type.');
    }
  }
  /**
   * getImageURIMimeType
   * @param {*} uri
   * @returns {*}
   */
  function getImageURIMimeType(uri) {
    if (uri.search(/\.jpe?g($|\?)/i) > 0 || uri.search(/^data\:image\/jpeg/) === 0) return 'image/jpeg';
    if (uri.search(/\.webp($|\?)/i) > 0 || uri.search(/^data\:image\/webp/) === 0) return 'image/webp';
    return 'image/png';
  }
  var _identityMatrix = new import_three2.Matrix4();
  var GLTFParser = class {
    constructor(json = {}, options = {}) {
      this.json = json;
      this.extensions = {};
      this.plugins = {};
      this.options = options;
      this.cache = new GLTFRegistry();
      this.associations = /* @__PURE__ */ new Map();
      this.primitiveCache = {};
      this.nodeCache = {};
      this.meshCache = { refs: {}, uses: {} };
      this.cameraCache = { refs: {}, uses: {} };
      this.lightCache = { refs: {}, uses: {} };
      this.sourceCache = {};
      this.textureCache = {};
      this.nodeNamesUsed = {};
      let isSafari = false;
      let isFirefox = false;
      let firefoxVersion = -1;
      if (typeof navigator !== 'undefined') {
        isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) === true;
        isFirefox = navigator.userAgent.indexOf('Firefox') > -1;
        firefoxVersion = isFirefox ? navigator.userAgent.match(/Firefox\/([0-9]+)\./)[1] : -1;
      }
      if (typeof createImageBitmap === 'undefined' || isSafari || (isFirefox && firefoxVersion < 98)) {
        this.textureLoader = new import_three2.TextureLoader(this.options.manager);
      } else {
        this.textureLoader = new import_three2.ImageBitmapLoader(this.options.manager);
      }
      this.textureLoader.setCrossOrigin(this.options.crossOrigin);
      this.textureLoader.setRequestHeader(this.options.requestHeader);
      this.fileLoader = new import_three2.FileLoader(this.options.manager);
      this.fileLoader.setResponseType('arraybuffer');
      if (this.options.crossOrigin === 'use-credentials') {
        this.fileLoader.setWithCredentials(true);
      }
    }
    setExtensions(extensions) {
      this.extensions = extensions;
    }
    setPlugins(plugins) {
      this.plugins = plugins;
    }
    parse(onLoad, onError) {
      const parser = this;
      const json = this.json;
      const extensions = this.extensions;
      this.cache.removeAll();
      this.nodeCache = {};
      this._invokeAll(function (ext) {
        return ext._markDefs && ext._markDefs();
      });
      Promise.all(
        this._invokeAll(function (ext) {
          return ext.beforeRoot && ext.beforeRoot();
        })
      )
        .then(function () {
          return Promise.all([
            parser.getDependencies('scene'),
            parser.getDependencies('animation'),
            parser.getDependencies('camera'),
          ]);
        })
        .then(function (dependencies) {
          const result = {
            scene: dependencies[0][json.scene || 0],
            scenes: dependencies[0],
            animations: dependencies[1],
            cameras: dependencies[2],
            asset: json.asset,
            parser,
            userData: {},
          };
          addUnknownExtensionsToUserData(extensions, result, json);
          assignExtrasToUserData(result, json);
          return Promise.all(
            parser._invokeAll(function (ext) {
              return ext.afterRoot && ext.afterRoot(result);
            })
          ).then(function () {
            onLoad(result);
          });
        })
        .catch(onError);
    }
    /**
     * Marks the special nodes/meshes in json for efficient parse.
     */
    _markDefs() {
      const nodeDefs = this.json.nodes || [];
      const skinDefs = this.json.skins || [];
      const meshDefs = this.json.meshes || [];
      for (let skinIndex = 0, skinLength = skinDefs.length; skinIndex < skinLength; skinIndex++) {
        const joints = skinDefs[skinIndex].joints;
        for (let i = 0, il = joints.length; i < il; i++) {
          nodeDefs[joints[i]].isBone = true;
        }
      }
      for (let nodeIndex = 0, nodeLength = nodeDefs.length; nodeIndex < nodeLength; nodeIndex++) {
        const nodeDef = nodeDefs[nodeIndex];
        if (nodeDef.mesh !== void 0) {
          this._addNodeRef(this.meshCache, nodeDef.mesh);
          if (nodeDef.skin !== void 0) {
            meshDefs[nodeDef.mesh].isSkinnedMesh = true;
          }
        }
        if (nodeDef.camera !== void 0) {
          this._addNodeRef(this.cameraCache, nodeDef.camera);
        }
      }
    }
    /**
     * Counts references to shared node / Object3D resources. These resources
     * can be reused, or "instantiated", at multiple nodes in the scene
     * hierarchy. Mesh, Camera, and Light instances are instantiated and must
     * be marked. Non-scenegraph resources (like Materials, Geometries, and
     * Textures) can be reused directly and are not marked here.
     *
     * Example: CesiumMilkTruck sample model reuses "Wheel" meshes.
     */
    _addNodeRef(cache, index) {
      if (index === void 0) return;
      if (cache.refs[index] === void 0) {
        cache.refs[index] = cache.uses[index] = 0;
      }
      cache.refs[index]++;
    }
    /** Returns a reference to a shared resource, cloning it if necessary. */
    _getNodeRef(cache, index, object) {
      if (cache.refs[index] <= 1) return object;
      const ref = object.clone();
      const updateMappings = (original, clone) => {
        const mappings = this.associations.get(original);
        if (mappings !== null) {
          this.associations.set(clone, mappings);
        }
        for (const [i, child] of original.children.entries()) {
          updateMappings(child, clone.children[i]);
        }
      };
      updateMappings(object, ref);
      ref.name += '_instance_' + cache.uses[index]++;
      return ref;
    }
    _invokeOne(func) {
      const extensions = Object.values(this.plugins);
      extensions.push(this);
      for (let i = 0; i < extensions.length; i++) {
        const result = func(extensions[i]);
        if (result) return result;
      }
      return null;
    }
    _invokeAll(func) {
      const extensions = Object.values(this.plugins);
      extensions.unshift(this);
      const pending = [];
      for (let i = 0; i < extensions.length; i++) {
        const result = func(extensions[i]);
        if (result) pending.push(result);
      }
      return pending;
    }
    /**
     * Requests the specified dependency asynchronously, with caching.
     * @param {string} type
     * @param {number} index
     * @return {Promise<Object3D|Material|THREE.Texture|AnimationClip|ArrayBuffer|Object>}
     */
    getDependency(type, index) {
      const cacheKey = type + ':' + index;
      let dependency = this.cache.get(cacheKey);
      if (!dependency) {
        switch (type) {
          case 'scene':
            dependency = this.loadScene(index);
            break;
          case 'node':
            dependency = this._invokeOne(function (ext) {
              return ext.loadNode && ext.loadNode(index);
            });
            break;
          case 'mesh':
            dependency = this._invokeOne(function (ext) {
              return ext.loadMesh && ext.loadMesh(index);
            });
            break;
          case 'accessor':
            dependency = this.loadAccessor(index);
            break;
          case 'bufferView':
            dependency = this._invokeOne(function (ext) {
              return ext.loadBufferView && ext.loadBufferView(index);
            });
            break;
          case 'buffer':
            dependency = this.loadBuffer(index);
            break;
          case 'material':
            dependency = this._invokeOne(function (ext) {
              return ext.loadMaterial && ext.loadMaterial(index);
            });
            break;
          case 'texture':
            dependency = this._invokeOne(function (ext) {
              return ext.loadTexture && ext.loadTexture(index);
            });
            break;
          case 'skin':
            dependency = this.loadSkin(index);
            break;
          case 'animation':
            dependency = this._invokeOne(function (ext) {
              return ext.loadAnimation && ext.loadAnimation(index);
            });
            break;
          case 'camera':
            dependency = this.loadCamera(index);
            break;
          default:
            dependency = this._invokeOne(function (ext) {
              return ext !== this && ext.getDependency && ext.getDependency(type, index);
            });
            if (!dependency) {
              throw new Error('Unknown type: ' + type);
            }
            break;
        }
        this.cache.add(cacheKey, dependency);
      }
      return dependency;
    }
    /**
     * Requests all dependencies of the specified type asynchronously, with caching.
     * @param {string} type
     * @return {Promise<Array<Object>>}
     */
    getDependencies(type) {
      let dependencies = this.cache.get(type);
      if (!dependencies) {
        const parser = this;
        const defs = this.json[type + (type === 'mesh' ? 'es' : 's')] || [];
        dependencies = Promise.all(
          defs.map(function (def, index) {
            return parser.getDependency(type, index);
          })
        );
        this.cache.add(type, dependencies);
      }
      return dependencies;
    }
    /**
     * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#buffers-and-buffer-views
     * @param {number} bufferIndex
     * @return {Promise<ArrayBuffer>}
     */
    loadBuffer(bufferIndex) {
      const bufferDef = this.json.buffers[bufferIndex];
      const loader = this.fileLoader;
      if (bufferDef.type && bufferDef.type !== 'arraybuffer') {
        throw new Error('THREE.GLTFLoader: ' + bufferDef.type + ' buffer type is not supported.');
      }
      if (bufferDef.uri === void 0 && bufferIndex === 0) {
        return Promise.resolve(this.extensions[EXTENSIONS.KHR_BINARY_GLTF].body);
      }
      const options = this.options;
      return new Promise(function (resolve, reject) {
        loader.load(import_three2.LoaderUtils.resolveURL(bufferDef.uri, options.path), resolve, void 0, function () {
          reject(new Error('THREE.GLTFLoader: Failed to load buffer "' + bufferDef.uri + '".'));
        });
      });
    }
    /**
     * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#buffers-and-buffer-views
     * @param {number} bufferViewIndex
     * @return {Promise<ArrayBuffer>}
     */
    loadBufferView(bufferViewIndex) {
      const bufferViewDef = this.json.bufferViews[bufferViewIndex];
      return this.getDependency('buffer', bufferViewDef.buffer).then(function (buffer) {
        const byteLength = bufferViewDef.byteLength || 0;
        const byteOffset = bufferViewDef.byteOffset || 0;
        return buffer.slice(byteOffset, byteOffset + byteLength);
      });
    }
    /**
     * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#accessors
     * @param {number} accessorIndex
     * @return {Promise<BufferAttribute|InterleavedBufferAttribute>}
     */
    loadAccessor(accessorIndex) {
      const parser = this;
      const json = this.json;
      const accessorDef = this.json.accessors[accessorIndex];
      if (accessorDef.bufferView === void 0 && accessorDef.sparse === void 0) {
        const itemSize = WEBGL_TYPE_SIZES[accessorDef.type];
        const TypedArray = WEBGL_COMPONENT_TYPES[accessorDef.componentType];
        const normalized = accessorDef.normalized === true;
        const array = new TypedArray(accessorDef.count * itemSize);
        return Promise.resolve(new import_three2.BufferAttribute(array, itemSize, normalized));
      }
      const pendingBufferViews = [];
      if (accessorDef.bufferView !== void 0) {
        pendingBufferViews.push(this.getDependency('bufferView', accessorDef.bufferView));
      } else {
        pendingBufferViews.push(null);
      }
      if (accessorDef.sparse !== void 0) {
        pendingBufferViews.push(this.getDependency('bufferView', accessorDef.sparse.indices.bufferView));
        pendingBufferViews.push(this.getDependency('bufferView', accessorDef.sparse.values.bufferView));
      }
      return Promise.all(pendingBufferViews).then(function (bufferViews) {
        const bufferView = bufferViews[0];
        const itemSize = WEBGL_TYPE_SIZES[accessorDef.type];
        const TypedArray = WEBGL_COMPONENT_TYPES[accessorDef.componentType];
        const elementBytes = TypedArray.BYTES_PER_ELEMENT;
        const itemBytes = elementBytes * itemSize;
        const byteOffset = accessorDef.byteOffset || 0;
        const byteStride =
          accessorDef.bufferView !== void 0 ? json.bufferViews[accessorDef.bufferView].byteStride : void 0;
        const normalized = accessorDef.normalized === true;
        let array, bufferAttribute;
        if (byteStride && byteStride !== itemBytes) {
          const ibSlice = Math.floor(byteOffset / byteStride);
          const ibCacheKey =
            'InterleavedBuffer:' +
            accessorDef.bufferView +
            ':' +
            accessorDef.componentType +
            ':' +
            ibSlice +
            ':' +
            accessorDef.count;
          let ib = parser.cache.get(ibCacheKey);
          if (!ib) {
            array = new TypedArray(bufferView, ibSlice * byteStride, (accessorDef.count * byteStride) / elementBytes);
            ib = new import_three2.InterleavedBuffer(array, byteStride / elementBytes);
            parser.cache.add(ibCacheKey, ib);
          }
          bufferAttribute = new import_three2.InterleavedBufferAttribute(
            ib,
            itemSize,
            (byteOffset % byteStride) / elementBytes,
            normalized
          );
        } else {
          if (buffer