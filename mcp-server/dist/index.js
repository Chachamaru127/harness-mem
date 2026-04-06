var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/zod/v4/core/core.js
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    var _a;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a = inst._zod).traits ?? (_a.traits = /* @__PURE__ */ new Set());
    inst._zod.traits.add(name);
    initializer3(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
var NEVER, $ZodAsyncError, globalConfig;
var init_core = __esm({
  "node_modules/zod/v4/core/core.js"() {
    NEVER = Object.freeze({
      status: "aborted"
    });
    $ZodAsyncError = class extends Error {
      constructor() {
        super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
      }
    };
    globalConfig = {};
  }
});

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  stringifyPrimitive: () => stringifyPrimitive,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error();
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function defineLazy(object3, key, getter) {
  const set = false;
  Object.defineProperty(object3, key, {
    get() {
      if (!set) {
        const value = getter();
        object3[key] = value;
        return value;
      }
      throw new Error("cached value already set");
    },
    set(v) {
      Object.defineProperty(object3, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function getElementAtPath(obj, path6) {
  if (!path6)
    return obj;
  return path6.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
function pick(schema, mask) {
  const newShape = {};
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    newShape[key] = currDef.shape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function omit(schema, mask) {
  const newShape = { ...schema._zod.def.shape };
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    delete newShape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
    // delete existing checks
  };
  return clone(schema, def);
}
function merge(a, b) {
  return clone(a, {
    ...a._zod.def,
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    catchall: b._zod.def.catchall,
    checks: []
    // delete existing checks
  });
}
function partial(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in oldShape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  } else {
    for (const key in oldShape) {
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function required(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in shape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  } else {
    for (const key in oldShape) {
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    // optional: [],
    checks: []
  });
}
function aborted(x, startIndex = 0) {
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true)
      return true;
  }
  return false;
}
function prefixIssues(path6, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path6);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
var captureStackTrace, allowsEval, getParsedType, propertyKeyTypes, primitiveTypes, NUMBER_FORMAT_RANGES, BIGINT_FORMAT_RANGES, Class;
var init_util = __esm({
  "node_modules/zod/v4/core/util.js"() {
    captureStackTrace = Error.captureStackTrace ? Error.captureStackTrace : (..._args) => {
    };
    allowsEval = cached(() => {
      if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
        return false;
      }
      try {
        const F = Function;
        new F("");
        return true;
      } catch (_) {
        return false;
      }
    });
    getParsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "undefined":
          return "undefined";
        case "string":
          return "string";
        case "number":
          return Number.isNaN(data) ? "nan" : "number";
        case "boolean":
          return "boolean";
        case "function":
          return "function";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        case "object":
          if (Array.isArray(data)) {
            return "array";
          }
          if (data === null) {
            return "null";
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return "promise";
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return "map";
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return "set";
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return "date";
          }
          if (typeof File !== "undefined" && data instanceof File) {
            return "file";
          }
          return "object";
        default:
          throw new Error(`Unknown data type: ${t}`);
      }
    };
    propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
    primitiveTypes = /* @__PURE__ */ new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
    NUMBER_FORMAT_RANGES = {
      safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      int32: [-2147483648, 2147483647],
      uint32: [0, 4294967295],
      float32: [-34028234663852886e22, 34028234663852886e22],
      float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
    };
    BIGINT_FORMAT_RANGES = {
      int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
      uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
    };
    Class = class {
      constructor(..._args) {
      }
    };
  }
});

// node_modules/zod/v4/core/errors.js
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, _mapper) {
  const mapper = _mapper || function(issue2) {
    return issue2.message;
  };
  const fieldErrors = { _errors: [] };
  const processError = (error3) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}
var initializer, $ZodError, $ZodRealError;
var init_errors = __esm({
  "node_modules/zod/v4/core/errors.js"() {
    init_core();
    init_util();
    initializer = (inst, def) => {
      inst.name = "$ZodError";
      Object.defineProperty(inst, "_zod", {
        value: inst._zod,
        enumerable: false
      });
      Object.defineProperty(inst, "issues", {
        value: def,
        enumerable: false
      });
      Object.defineProperty(inst, "message", {
        get() {
          return JSON.stringify(def, jsonStringifyReplacer, 2);
        },
        enumerable: true
        // configurable: false,
      });
      Object.defineProperty(inst, "toString", {
        value: () => inst.message,
        enumerable: false
      });
    };
    $ZodError = $constructor("$ZodError", initializer);
    $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
  }
});

// node_modules/zod/v4/core/parse.js
var _parse, _parseAsync, _safeParse, safeParse, _safeParseAsync, safeParseAsync;
var init_parse = __esm({
  "node_modules/zod/v4/core/parse.js"() {
    init_core();
    init_errors();
    init_util();
    _parse = (_Err) => (schema, value, _ctx, _params) => {
      const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
      const result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise) {
        throw new $ZodAsyncError();
      }
      if (result.issues.length) {
        const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
        captureStackTrace(e, _params?.callee);
        throw e;
      }
      return result.value;
    };
    _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
      const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
      let result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise)
        result = await result;
      if (result.issues.length) {
        const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
        captureStackTrace(e, params?.callee);
        throw e;
      }
      return result.value;
    };
    _safeParse = (_Err) => (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
      const result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise) {
        throw new $ZodAsyncError();
      }
      return result.issues.length ? {
        success: false,
        error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
      } : { success: true, data: result.value };
    };
    safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
    _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
      const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
      let result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise)
        result = await result;
      return result.issues.length ? {
        success: false,
        error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
      } : { success: true, data: result.value };
    };
    safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
  }
});

// node_modules/zod/v4/core/regexes.js
function emoji() {
  return new RegExp(_emoji, "u");
}
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-]\\d{2}:\\d{2})`);
  const timeRegex = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var cuid, cuid2, ulid, xid, ksuid, nanoid, duration, guid, uuid, email, _emoji, ipv4, ipv6, cidrv4, cidrv6, base64, base64url, hostname, e164, dateSource, date, string, integer, number, boolean, _null, lowercase, uppercase;
var init_regexes = __esm({
  "node_modules/zod/v4/core/regexes.js"() {
    cuid = /^[cC][^\s-]{8,}$/;
    cuid2 = /^[0-9a-z]+$/;
    ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
    xid = /^[0-9a-vA-V]{20}$/;
    ksuid = /^[A-Za-z0-9]{27}$/;
    nanoid = /^[a-zA-Z0-9_-]{21}$/;
    duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
    guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
    uuid = (version2) => {
      if (!version2)
        return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
      return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
    };
    email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
    _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
    ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/;
    cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
    cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
    base64url = /^[A-Za-z0-9_-]*$/;
    hostname = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
    e164 = /^\+(?:[0-9]){6,14}[0-9]$/;
    dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
    date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
    string = (params) => {
      const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
      return new RegExp(`^${regex}$`);
    };
    integer = /^\d+$/;
    number = /^-?\d+(?:\.\d+)?/i;
    boolean = /true|false/i;
    _null = /null/i;
    lowercase = /^[^A-Z]*$/;
    uppercase = /^[^a-z]*$/;
  }
});

// node_modules/zod/v4/core/checks.js
var $ZodCheck, numericOriginMap, $ZodCheckLessThan, $ZodCheckGreaterThan, $ZodCheckMultipleOf, $ZodCheckNumberFormat, $ZodCheckMaxLength, $ZodCheckMinLength, $ZodCheckLengthEquals, $ZodCheckStringFormat, $ZodCheckRegex, $ZodCheckLowerCase, $ZodCheckUpperCase, $ZodCheckIncludes, $ZodCheckStartsWith, $ZodCheckEndsWith, $ZodCheckOverwrite;
var init_checks = __esm({
  "node_modules/zod/v4/core/checks.js"() {
    init_core();
    init_regexes();
    init_util();
    $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
      var _a;
      inst._zod ?? (inst._zod = {});
      inst._zod.def = def;
      (_a = inst._zod).onattach ?? (_a.onattach = []);
    });
    numericOriginMap = {
      number: "number",
      bigint: "bigint",
      object: "date"
    };
    $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
      $ZodCheck.init(inst, def);
      const origin = numericOriginMap[typeof def.value];
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
        if (def.value < curr) {
          if (def.inclusive)
            bag.maximum = def.value;
          else
            bag.exclusiveMaximum = def.value;
        }
      });
      inst._zod.check = (payload) => {
        if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
          return;
        }
        payload.issues.push({
          origin,
          code: "too_big",
          maximum: def.value,
          input: payload.value,
          inclusive: def.inclusive,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
      $ZodCheck.init(inst, def);
      const origin = numericOriginMap[typeof def.value];
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
        if (def.value > curr) {
          if (def.inclusive)
            bag.minimum = def.value;
          else
            bag.exclusiveMinimum = def.value;
        }
      });
      inst._zod.check = (payload) => {
        if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
          return;
        }
        payload.issues.push({
          origin,
          code: "too_small",
          minimum: def.value,
          input: payload.value,
          inclusive: def.inclusive,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
      $ZodCheck.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        var _a;
        (_a = inst2._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
      });
      inst._zod.check = (payload) => {
        if (typeof payload.value !== typeof def.value)
          throw new Error("Cannot mix number and bigint in multiple_of check.");
        const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
        if (isMultiple)
          return;
        payload.issues.push({
          origin: typeof payload.value,
          code: "not_multiple_of",
          divisor: def.value,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
      $ZodCheck.init(inst, def);
      def.format = def.format || "float64";
      const isInt = def.format?.includes("int");
      const origin = isInt ? "int" : "number";
      const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.format = def.format;
        bag.minimum = minimum;
        bag.maximum = maximum;
        if (isInt)
          bag.pattern = integer;
      });
      inst._zod.check = (payload) => {
        const input = payload.value;
        if (isInt) {
          if (!Number.isInteger(input)) {
            payload.issues.push({
              expected: origin,
              format: def.format,
              code: "invalid_type",
              input,
              inst
            });
            return;
          }
          if (!Number.isSafeInteger(input)) {
            if (input > 0) {
              payload.issues.push({
                input,
                code: "too_big",
                maximum: Number.MAX_SAFE_INTEGER,
                note: "Integers must be within the safe integer range.",
                inst,
                origin,
                continue: !def.abort
              });
            } else {
              payload.issues.push({
                input,
                code: "too_small",
                minimum: Number.MIN_SAFE_INTEGER,
                note: "Integers must be within the safe integer range.",
                inst,
                origin,
                continue: !def.abort
              });
            }
            return;
          }
        }
        if (input < minimum) {
          payload.issues.push({
            origin: "number",
            input,
            code: "too_small",
            minimum,
            inclusive: true,
            inst,
            continue: !def.abort
          });
        }
        if (input > maximum) {
          payload.issues.push({
            origin: "number",
            input,
            code: "too_big",
            maximum,
            inst
          });
        }
      };
    });
    $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
      var _a;
      $ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = (payload) => {
        const val = payload.value;
        return !nullish(val) && val.length !== void 0;
      });
      inst._zod.onattach.push((inst2) => {
        const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
        if (def.maximum < curr)
          inst2._zod.bag.maximum = def.maximum;
      });
      inst._zod.check = (payload) => {
        const input = payload.value;
        const length = input.length;
        if (length <= def.maximum)
          return;
        const origin = getLengthableOrigin(input);
        payload.issues.push({
          origin,
          code: "too_big",
          maximum: def.maximum,
          inclusive: true,
          input,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
      var _a;
      $ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = (payload) => {
        const val = payload.value;
        return !nullish(val) && val.length !== void 0;
      });
      inst._zod.onattach.push((inst2) => {
        const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
        if (def.minimum > curr)
          inst2._zod.bag.minimum = def.minimum;
      });
      inst._zod.check = (payload) => {
        const input = payload.value;
        const length = input.length;
        if (length >= def.minimum)
          return;
        const origin = getLengthableOrigin(input);
        payload.issues.push({
          origin,
          code: "too_small",
          minimum: def.minimum,
          inclusive: true,
          input,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
      var _a;
      $ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = (payload) => {
        const val = payload.value;
        return !nullish(val) && val.length !== void 0;
      });
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.minimum = def.length;
        bag.maximum = def.length;
        bag.length = def.length;
      });
      inst._zod.check = (payload) => {
        const input = payload.value;
        const length = input.length;
        if (length === def.length)
          return;
        const origin = getLengthableOrigin(input);
        const tooBig = length > def.length;
        payload.issues.push({
          origin,
          ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
          inclusive: true,
          exact: true,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
      var _a, _b;
      $ZodCheck.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.format = def.format;
        if (def.pattern) {
          bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
          bag.patterns.add(def.pattern);
        }
      });
      if (def.pattern)
        (_a = inst._zod).check ?? (_a.check = (payload) => {
          def.pattern.lastIndex = 0;
          if (def.pattern.test(payload.value))
            return;
          payload.issues.push({
            origin: "string",
            code: "invalid_format",
            format: def.format,
            input: payload.value,
            ...def.pattern ? { pattern: def.pattern.toString() } : {},
            inst,
            continue: !def.abort
          });
        });
      else
        (_b = inst._zod).check ?? (_b.check = () => {
        });
    });
    $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
      $ZodCheckStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        def.pattern.lastIndex = 0;
        if (def.pattern.test(payload.value))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "regex",
          input: payload.value,
          pattern: def.pattern.toString(),
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
      def.pattern ?? (def.pattern = lowercase);
      $ZodCheckStringFormat.init(inst, def);
    });
    $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
      def.pattern ?? (def.pattern = uppercase);
      $ZodCheckStringFormat.init(inst, def);
    });
    $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
      $ZodCheck.init(inst, def);
      const escapedRegex = escapeRegex(def.includes);
      const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
      def.pattern = pattern;
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
        bag.patterns.add(pattern);
      });
      inst._zod.check = (payload) => {
        if (payload.value.includes(def.includes, def.position))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "includes",
          includes: def.includes,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
      $ZodCheck.init(inst, def);
      const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
      def.pattern ?? (def.pattern = pattern);
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
        bag.patterns.add(pattern);
      });
      inst._zod.check = (payload) => {
        if (payload.value.startsWith(def.prefix))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "starts_with",
          prefix: def.prefix,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
      $ZodCheck.init(inst, def);
      const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
      def.pattern ?? (def.pattern = pattern);
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
        bag.patterns.add(pattern);
      });
      inst._zod.check = (payload) => {
        if (payload.value.endsWith(def.suffix))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "ends_with",
          suffix: def.suffix,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
      $ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        payload.value = def.tx(payload.value);
      };
    });
  }
});

// node_modules/zod/v4/core/doc.js
var Doc;
var init_doc = __esm({
  "node_modules/zod/v4/core/doc.js"() {
    Doc = class {
      constructor(args = []) {
        this.content = [];
        this.indent = 0;
        if (this)
          this.args = args;
      }
      indented(fn) {
        this.indent += 1;
        fn(this);
        this.indent -= 1;
      }
      write(arg) {
        if (typeof arg === "function") {
          arg(this, { execution: "sync" });
          arg(this, { execution: "async" });
          return;
        }
        const content = arg;
        const lines = content.split("\n").filter((x) => x);
        const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
        const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
        for (const line of dedented) {
          this.content.push(line);
        }
      }
      compile() {
        const F = Function;
        const args = this?.args;
        const content = this?.content ?? [``];
        const lines = [...content.map((x) => `  ${x}`)];
        return new F(...args, lines.join("\n"));
      }
    };
  }
});

// node_modules/zod/v4/core/versions.js
var version;
var init_versions = __esm({
  "node_modules/zod/v4/core/versions.js"() {
    version = {
      major: 4,
      minor: 0,
      patch: 0
    };
  }
});

// node_modules/zod/v4/core/schemas.js
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleObjectResult(result, final, key) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  final.value[key] = result.value;
}
function handleOptionalObjectResult(result, final, key, input) {
  if (result.issues.length) {
    if (input[key] === void 0) {
      if (key in input) {
        final.value[key] = void 0;
      } else {
        final.value[key] = result.value;
      }
    } else {
      final.issues.push(...prefixIssues(key, result.issues));
    }
  } else if (result.value === void 0) {
    if (key in input)
      final.value[key] = void 0;
  } else {
    final.value[key] = result.value;
  }
}
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handlePipeResult(left, def, ctx) {
  if (aborted(left)) {
    return left;
  }
  return def.out._zod.run({ value: left.value, issues: left.issues }, ctx);
}
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
var $ZodType, $ZodString, $ZodStringFormat, $ZodGUID, $ZodUUID, $ZodEmail, $ZodURL, $ZodEmoji, $ZodNanoID, $ZodCUID, $ZodCUID2, $ZodULID, $ZodXID, $ZodKSUID, $ZodISODateTime, $ZodISODate, $ZodISOTime, $ZodISODuration, $ZodIPv4, $ZodIPv6, $ZodCIDRv4, $ZodCIDRv6, $ZodBase64, $ZodBase64URL, $ZodE164, $ZodJWT, $ZodNumber, $ZodNumberFormat, $ZodBoolean, $ZodNull, $ZodUnknown, $ZodNever, $ZodArray, $ZodObject, $ZodUnion, $ZodDiscriminatedUnion, $ZodIntersection, $ZodRecord, $ZodEnum, $ZodLiteral, $ZodTransform, $ZodOptional, $ZodNullable, $ZodDefault, $ZodPrefault, $ZodNonOptional, $ZodCatch, $ZodPipe, $ZodReadonly, $ZodCustom;
var init_schemas = __esm({
  "node_modules/zod/v4/core/schemas.js"() {
    init_checks();
    init_core();
    init_doc();
    init_parse();
    init_regexes();
    init_util();
    init_versions();
    init_util();
    $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
      var _a;
      inst ?? (inst = {});
      inst._zod.def = def;
      inst._zod.bag = inst._zod.bag || {};
      inst._zod.version = version;
      const checks = [...inst._zod.def.checks ?? []];
      if (inst._zod.traits.has("$ZodCheck")) {
        checks.unshift(inst);
      }
      for (const ch of checks) {
        for (const fn of ch._zod.onattach) {
          fn(inst);
        }
      }
      if (checks.length === 0) {
        (_a = inst._zod).deferred ?? (_a.deferred = []);
        inst._zod.deferred?.push(() => {
          inst._zod.run = inst._zod.parse;
        });
      } else {
        const runChecks = (payload, checks2, ctx) => {
          let isAborted = aborted(payload);
          let asyncResult;
          for (const ch of checks2) {
            if (ch._zod.def.when) {
              const shouldRun = ch._zod.def.when(payload);
              if (!shouldRun)
                continue;
            } else if (isAborted) {
              continue;
            }
            const currLen = payload.issues.length;
            const _ = ch._zod.check(payload);
            if (_ instanceof Promise && ctx?.async === false) {
              throw new $ZodAsyncError();
            }
            if (asyncResult || _ instanceof Promise) {
              asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
                await _;
                const nextLen = payload.issues.length;
                if (nextLen === currLen)
                  return;
                if (!isAborted)
                  isAborted = aborted(payload, currLen);
              });
            } else {
              const nextLen = payload.issues.length;
              if (nextLen === currLen)
                continue;
              if (!isAborted)
                isAborted = aborted(payload, currLen);
            }
          }
          if (asyncResult) {
            return asyncResult.then(() => {
              return payload;
            });
          }
          return payload;
        };
        inst._zod.run = (payload, ctx) => {
          const result = inst._zod.parse(payload, ctx);
          if (result instanceof Promise) {
            if (ctx.async === false)
              throw new $ZodAsyncError();
            return result.then((result2) => runChecks(result2, checks, ctx));
          }
          return runChecks(result, checks, ctx);
        };
      }
      inst["~standard"] = {
        validate: (value) => {
          try {
            const r = safeParse(inst, value);
            return r.success ? { value: r.data } : { issues: r.error?.issues };
          } catch (_) {
            return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
          }
        },
        vendor: "zod",
        version: 1
      };
    });
    $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
      inst._zod.parse = (payload, _) => {
        if (def.coerce)
          try {
            payload.value = String(payload.value);
          } catch (_2) {
          }
        if (typeof payload.value === "string")
          return payload;
        payload.issues.push({
          expected: "string",
          code: "invalid_type",
          input: payload.value,
          inst
        });
        return payload;
      };
    });
    $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
      $ZodCheckStringFormat.init(inst, def);
      $ZodString.init(inst, def);
    });
    $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
      def.pattern ?? (def.pattern = guid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
      if (def.version) {
        const versionMap = {
          v1: 1,
          v2: 2,
          v3: 3,
          v4: 4,
          v5: 5,
          v6: 6,
          v7: 7,
          v8: 8
        };
        const v = versionMap[def.version];
        if (v === void 0)
          throw new Error(`Invalid UUID version: "${def.version}"`);
        def.pattern ?? (def.pattern = uuid(v));
      } else
        def.pattern ?? (def.pattern = uuid());
      $ZodStringFormat.init(inst, def);
    });
    $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
      def.pattern ?? (def.pattern = email);
      $ZodStringFormat.init(inst, def);
    });
    $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        try {
          const orig = payload.value;
          const url = new URL(orig);
          const href = url.href;
          if (def.hostname) {
            def.hostname.lastIndex = 0;
            if (!def.hostname.test(url.hostname)) {
              payload.issues.push({
                code: "invalid_format",
                format: "url",
                note: "Invalid hostname",
                pattern: hostname.source,
                input: payload.value,
                inst,
                continue: !def.abort
              });
            }
          }
          if (def.protocol) {
            def.protocol.lastIndex = 0;
            if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
              payload.issues.push({
                code: "invalid_format",
                format: "url",
                note: "Invalid protocol",
                pattern: def.protocol.source,
                input: payload.value,
                inst,
                continue: !def.abort
              });
            }
          }
          if (!orig.endsWith("/") && href.endsWith("/")) {
            payload.value = href.slice(0, -1);
          } else {
            payload.value = href;
          }
          return;
        } catch (_) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
      def.pattern ?? (def.pattern = emoji());
      $ZodStringFormat.init(inst, def);
    });
    $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
      def.pattern ?? (def.pattern = nanoid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
      def.pattern ?? (def.pattern = cuid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
      def.pattern ?? (def.pattern = cuid2);
      $ZodStringFormat.init(inst, def);
    });
    $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
      def.pattern ?? (def.pattern = ulid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
      def.pattern ?? (def.pattern = xid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
      def.pattern ?? (def.pattern = ksuid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
      def.pattern ?? (def.pattern = datetime(def));
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
      def.pattern ?? (def.pattern = date);
      $ZodStringFormat.init(inst, def);
    });
    $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
      def.pattern ?? (def.pattern = time(def));
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
      def.pattern ?? (def.pattern = duration);
      $ZodStringFormat.init(inst, def);
    });
    $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
      def.pattern ?? (def.pattern = ipv4);
      $ZodStringFormat.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.format = `ipv4`;
      });
    });
    $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
      def.pattern ?? (def.pattern = ipv6);
      $ZodStringFormat.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        const bag = inst2._zod.bag;
        bag.format = `ipv6`;
      });
      inst._zod.check = (payload) => {
        try {
          new URL(`http://[${payload.value}]`);
        } catch {
          payload.issues.push({
            code: "invalid_format",
            format: "ipv6",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
      def.pattern ?? (def.pattern = cidrv4);
      $ZodStringFormat.init(inst, def);
    });
    $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
      def.pattern ?? (def.pattern = cidrv6);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        const [address, prefix] = payload.value.split("/");
        try {
          if (!prefix)
            throw new Error();
          const prefixNum = Number(prefix);
          if (`${prefixNum}` !== prefix)
            throw new Error();
          if (prefixNum < 0 || prefixNum > 128)
            throw new Error();
          new URL(`http://[${address}]`);
        } catch {
          payload.issues.push({
            code: "invalid_format",
            format: "cidrv6",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
      def.pattern ?? (def.pattern = base64);
      $ZodStringFormat.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        inst2._zod.bag.contentEncoding = "base64";
      });
      inst._zod.check = (payload) => {
        if (isValidBase64(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "base64",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
      def.pattern ?? (def.pattern = base64url);
      $ZodStringFormat.init(inst, def);
      inst._zod.onattach.push((inst2) => {
        inst2._zod.bag.contentEncoding = "base64url";
      });
      inst._zod.check = (payload) => {
        if (isValidBase64URL(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "base64url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
      def.pattern ?? (def.pattern = e164);
      $ZodStringFormat.init(inst, def);
    });
    $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidJWT(payload.value, def.alg))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "jwt",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = inst._zod.bag.pattern ?? number;
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce)
          try {
            payload.value = Number(payload.value);
          } catch (_) {
          }
        const input = payload.value;
        if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
          return payload;
        }
        const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
        payload.issues.push({
          expected: "number",
          code: "invalid_type",
          input,
          inst,
          ...received ? { received } : {}
        });
        return payload;
      };
    });
    $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
      $ZodCheckNumberFormat.init(inst, def);
      $ZodNumber.init(inst, def);
    });
    $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = boolean;
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce)
          try {
            payload.value = Boolean(payload.value);
          } catch (_) {
          }
        const input = payload.value;
        if (typeof input === "boolean")
          return payload;
        payload.issues.push({
          expected: "boolean",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = _null;
      inst._zod.values = /* @__PURE__ */ new Set([null]);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (input === null)
          return payload;
        payload.issues.push({
          expected: "null",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload) => payload;
    });
    $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        payload.issues.push({
          expected: "never",
          code: "invalid_type",
          input: payload.value,
          inst
        });
        return payload;
      };
    });
    $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!Array.isArray(input)) {
          payload.issues.push({
            expected: "array",
            code: "invalid_type",
            input,
            inst
          });
          return payload;
        }
        payload.value = Array(input.length);
        const proms = [];
        for (let i = 0; i < input.length; i++) {
          const item = input[i];
          const result = def.element._zod.run({
            value: item,
            issues: []
          }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
          } else {
            handleArrayResult(result, payload, i);
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => payload);
        }
        return payload;
      };
    });
    $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
      $ZodType.init(inst, def);
      const _normalized = cached(() => {
        const keys = Object.keys(def.shape);
        for (const k of keys) {
          if (!(def.shape[k] instanceof $ZodType)) {
            throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
          }
        }
        const okeys = optionalKeys(def.shape);
        return {
          shape: def.shape,
          keys,
          keySet: new Set(keys),
          numKeys: keys.length,
          optionalKeys: new Set(okeys)
        };
      });
      defineLazy(inst._zod, "propValues", () => {
        const shape = def.shape;
        const propValues = {};
        for (const key in shape) {
          const field = shape[key]._zod;
          if (field.values) {
            propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
            for (const v of field.values)
              propValues[key].add(v);
          }
        }
        return propValues;
      });
      const generateFastpass = (shape) => {
        const doc = new Doc(["shape", "payload", "ctx"]);
        const normalized = _normalized.value;
        const parseStr = (key) => {
          const k = esc(key);
          return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
        };
        doc.write(`const input = payload.value;`);
        const ids = /* @__PURE__ */ Object.create(null);
        let counter = 0;
        for (const key of normalized.keys) {
          ids[key] = `key_${counter++}`;
        }
        doc.write(`const newResult = {}`);
        for (const key of normalized.keys) {
          if (normalized.optionalKeys.has(key)) {
            const id = ids[key];
            doc.write(`const ${id} = ${parseStr(key)};`);
            const k = esc(key);
            doc.write(`
        if (${id}.issues.length) {
          if (input[${k}] === undefined) {
            if (${k} in input) {
              newResult[${k}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${id}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${k}, ...iss.path] : [${k}],
              }))
            );
          }
        } else if (${id}.value === undefined) {
          if (${k} in input) newResult[${k}] = undefined;
        } else {
          newResult[${k}] = ${id}.value;
        }
        `);
          } else {
            const id = ids[key];
            doc.write(`const ${id} = ${parseStr(key)};`);
            doc.write(`
          if (${id}.issues.length) payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${esc(key)}, ...iss.path] : [${esc(key)}]
          })));`);
            doc.write(`newResult[${esc(key)}] = ${id}.value`);
          }
        }
        doc.write(`payload.value = newResult;`);
        doc.write(`return payload;`);
        const fn = doc.compile();
        return (payload, ctx) => fn(shape, payload, ctx);
      };
      let fastpass;
      const isObject2 = isObject;
      const jit = !globalConfig.jitless;
      const allowsEval2 = allowsEval;
      const fastEnabled = jit && allowsEval2.value;
      const catchall = def.catchall;
      let value;
      inst._zod.parse = (payload, ctx) => {
        value ?? (value = _normalized.value);
        const input = payload.value;
        if (!isObject2(input)) {
          payload.issues.push({
            expected: "object",
            code: "invalid_type",
            input,
            inst
          });
          return payload;
        }
        const proms = [];
        if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
          if (!fastpass)
            fastpass = generateFastpass(def.shape);
          payload = fastpass(payload, ctx);
        } else {
          payload.value = {};
          const shape = value.shape;
          for (const key of value.keys) {
            const el = shape[key];
            const r = el._zod.run({ value: input[key], issues: [] }, ctx);
            const isOptional = el._zod.optin === "optional" && el._zod.optout === "optional";
            if (r instanceof Promise) {
              proms.push(r.then((r2) => isOptional ? handleOptionalObjectResult(r2, payload, key, input) : handleObjectResult(r2, payload, key)));
            } else if (isOptional) {
              handleOptionalObjectResult(r, payload, key, input);
            } else {
              handleObjectResult(r, payload, key);
            }
          }
        }
        if (!catchall) {
          return proms.length ? Promise.all(proms).then(() => payload) : payload;
        }
        const unrecognized = [];
        const keySet = value.keySet;
        const _catchall = catchall._zod;
        const t = _catchall.def.type;
        for (const key of Object.keys(input)) {
          if (keySet.has(key))
            continue;
          if (t === "never") {
            unrecognized.push(key);
            continue;
          }
          const r = _catchall.run({ value: input[key], issues: [] }, ctx);
          if (r instanceof Promise) {
            proms.push(r.then((r2) => handleObjectResult(r2, payload, key)));
          } else {
            handleObjectResult(r, payload, key);
          }
        }
        if (unrecognized.length) {
          payload.issues.push({
            code: "unrecognized_keys",
            keys: unrecognized,
            input,
            inst
          });
        }
        if (!proms.length)
          return payload;
        return Promise.all(proms).then(() => {
          return payload;
        });
      };
    });
    $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
      defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
      defineLazy(inst._zod, "values", () => {
        if (def.options.every((o) => o._zod.values)) {
          return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
        }
        return void 0;
      });
      defineLazy(inst._zod, "pattern", () => {
        if (def.options.every((o) => o._zod.pattern)) {
          const patterns = def.options.map((o) => o._zod.pattern);
          return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
        }
        return void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        let async = false;
        const results = [];
        for (const option of def.options) {
          const result = option._zod.run({
            value: payload.value,
            issues: []
          }, ctx);
          if (result instanceof Promise) {
            results.push(result);
            async = true;
          } else {
            if (result.issues.length === 0)
              return result;
            results.push(result);
          }
        }
        if (!async)
          return handleUnionResults(results, payload, inst, ctx);
        return Promise.all(results).then((results2) => {
          return handleUnionResults(results2, payload, inst, ctx);
        });
      };
    });
    $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
      $ZodUnion.init(inst, def);
      const _super = inst._zod.parse;
      defineLazy(inst._zod, "propValues", () => {
        const propValues = {};
        for (const option of def.options) {
          const pv = option._zod.propValues;
          if (!pv || Object.keys(pv).length === 0)
            throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
          for (const [k, v] of Object.entries(pv)) {
            if (!propValues[k])
              propValues[k] = /* @__PURE__ */ new Set();
            for (const val of v) {
              propValues[k].add(val);
            }
          }
        }
        return propValues;
      });
      const disc = cached(() => {
        const opts = def.options;
        const map = /* @__PURE__ */ new Map();
        for (const o of opts) {
          const values = o._zod.propValues[def.discriminator];
          if (!values || values.size === 0)
            throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
          for (const v of values) {
            if (map.has(v)) {
              throw new Error(`Duplicate discriminator value "${String(v)}"`);
            }
            map.set(v, o);
          }
        }
        return map;
      });
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!isObject(input)) {
          payload.issues.push({
            code: "invalid_type",
            expected: "object",
            input,
            inst
          });
          return payload;
        }
        const opt = disc.value.get(input?.[def.discriminator]);
        if (opt) {
          return opt._zod.run(payload, ctx);
        }
        if (def.unionFallback) {
          return _super(payload, ctx);
        }
        payload.issues.push({
          code: "invalid_union",
          errors: [],
          note: "No matching discriminator",
          input,
          path: [def.discriminator],
          inst
        });
        return payload;
      };
    });
    $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        const left = def.left._zod.run({ value: input, issues: [] }, ctx);
        const right = def.right._zod.run({ value: input, issues: [] }, ctx);
        const async = left instanceof Promise || right instanceof Promise;
        if (async) {
          return Promise.all([left, right]).then(([left2, right2]) => {
            return handleIntersectionResults(payload, left2, right2);
          });
        }
        return handleIntersectionResults(payload, left, right);
      };
    });
    $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!isPlainObject(input)) {
          payload.issues.push({
            expected: "record",
            code: "invalid_type",
            input,
            inst
          });
          return payload;
        }
        const proms = [];
        if (def.keyType._zod.values) {
          const values = def.keyType._zod.values;
          payload.value = {};
          for (const key of values) {
            if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
              const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
              if (result instanceof Promise) {
                proms.push(result.then((result2) => {
                  if (result2.issues.length) {
                    payload.issues.push(...prefixIssues(key, result2.issues));
                  }
                  payload.value[key] = result2.value;
                }));
              } else {
                if (result.issues.length) {
                  payload.issues.push(...prefixIssues(key, result.issues));
                }
                payload.value[key] = result.value;
              }
            }
          }
          let unrecognized;
          for (const key in input) {
            if (!values.has(key)) {
              unrecognized = unrecognized ?? [];
              unrecognized.push(key);
            }
          }
          if (unrecognized && unrecognized.length > 0) {
            payload.issues.push({
              code: "unrecognized_keys",
              input,
              inst,
              keys: unrecognized
            });
          }
        } else {
          payload.value = {};
          for (const key of Reflect.ownKeys(input)) {
            if (key === "__proto__")
              continue;
            const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
            if (keyResult instanceof Promise) {
              throw new Error("Async schemas not supported in object keys currently");
            }
            if (keyResult.issues.length) {
              payload.issues.push({
                origin: "record",
                code: "invalid_key",
                issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
                input: key,
                path: [key],
                inst
              });
              payload.value[keyResult.value] = keyResult.value;
              continue;
            }
            const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
            if (result instanceof Promise) {
              proms.push(result.then((result2) => {
                if (result2.issues.length) {
                  payload.issues.push(...prefixIssues(key, result2.issues));
                }
                payload.value[keyResult.value] = result2.value;
              }));
            } else {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[keyResult.value] = result.value;
            }
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => payload);
        }
        return payload;
      };
    });
    $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
      $ZodType.init(inst, def);
      const values = getEnumValues(def.entries);
      inst._zod.values = new Set(values);
      inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (inst._zod.values.has(input)) {
          return payload;
        }
        payload.issues.push({
          code: "invalid_value",
          values,
          input,
          inst
        });
        return payload;
      };
    });
    $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.values = new Set(def.values);
      inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? o.toString() : String(o)).join("|")})$`);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (inst._zod.values.has(input)) {
          return payload;
        }
        payload.issues.push({
          code: "invalid_value",
          values: def.values,
          input,
          inst
        });
        return payload;
      };
    });
    $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const _out = def.transform(payload.value, payload);
        if (_ctx.async) {
          const output = _out instanceof Promise ? _out : Promise.resolve(_out);
          return output.then((output2) => {
            payload.value = output2;
            return payload;
          });
        }
        if (_out instanceof Promise) {
          throw new $ZodAsyncError();
        }
        payload.value = _out;
        return payload;
      };
    });
    $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "optional";
      inst._zod.optout = "optional";
      defineLazy(inst._zod, "values", () => {
        return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
      });
      defineLazy(inst._zod, "pattern", () => {
        const pattern = def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        if (def.innerType._zod.optin === "optional") {
          return def.innerType._zod.run(payload, ctx);
        }
        if (payload.value === void 0) {
          return payload;
        }
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
      defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
      defineLazy(inst._zod, "pattern", () => {
        const pattern = def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
      });
      defineLazy(inst._zod, "values", () => {
        return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === null)
          return payload;
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "optional";
      defineLazy(inst._zod, "values", () => def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === void 0) {
          payload.value = def.defaultValue;
          return payload;
        }
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => handleDefaultResult(result2, def));
        }
        return handleDefaultResult(result, def);
      };
    });
    $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "optional";
      defineLazy(inst._zod, "values", () => def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === void 0) {
          payload.value = def.defaultValue;
        }
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "values", () => {
        const v = def.innerType._zod.values;
        return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => handleNonOptionalResult(result2, inst));
        }
        return handleNonOptionalResult(result, inst);
      };
    });
    $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "optional";
      defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
      defineLazy(inst._zod, "values", () => def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => {
            payload.value = result2.value;
            if (result2.issues.length) {
              payload.value = def.catchValue({
                ...payload,
                error: {
                  issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
                },
                input: payload.value
              });
              payload.issues = [];
            }
            return payload;
          });
        }
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      };
    });
    $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "values", () => def.in._zod.values);
      defineLazy(inst._zod, "optin", () => def.in._zod.optin);
      defineLazy(inst._zod, "optout", () => def.out._zod.optout);
      inst._zod.parse = (payload, ctx) => {
        const left = def.in._zod.run(payload, ctx);
        if (left instanceof Promise) {
          return left.then((left2) => handlePipeResult(left2, def, ctx));
        }
        return handlePipeResult(left, def, ctx);
      };
    });
    $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
      defineLazy(inst._zod, "values", () => def.innerType._zod.values);
      defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
      defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
      inst._zod.parse = (payload, ctx) => {
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then(handleReadonlyResult);
        }
        return handleReadonlyResult(result);
      };
    });
    $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
      $ZodCheck.init(inst, def);
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _) => {
        return payload;
      };
      inst._zod.check = (payload) => {
        const input = payload.value;
        const r = def.fn(input);
        if (r instanceof Promise) {
          return r.then((r2) => handleRefineResult(r2, payload, input, inst));
        }
        handleRefineResult(r, payload, input, inst);
        return;
      };
    });
  }
});

// node_modules/zod/v4/locales/en.js
function en_default() {
  return {
    localeError: error()
  };
}
var parsedType, error;
var init_en = __esm({
  "node_modules/zod/v4/locales/en.js"() {
    init_util();
    parsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "number": {
          return Number.isNaN(data) ? "NaN" : "number";
        }
        case "object": {
          if (Array.isArray(data)) {
            return "array";
          }
          if (data === null) {
            return "null";
          }
          if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
            return data.constructor.name;
          }
        }
      }
      return t;
    };
    error = () => {
      const Sizable = {
        string: { unit: "characters", verb: "to have" },
        file: { unit: "bytes", verb: "to have" },
        array: { unit: "items", verb: "to have" },
        set: { unit: "items", verb: "to have" }
      };
      function getSizing(origin) {
        return Sizable[origin] ?? null;
      }
      const Nouns = {
        regex: "input",
        email: "email address",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datetime",
        date: "ISO date",
        time: "ISO time",
        duration: "ISO duration",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded string",
        base64url: "base64url-encoded string",
        json_string: "JSON string",
        e164: "E.164 number",
        jwt: "JWT",
        template_literal: "input"
      };
      return (issue2) => {
        switch (issue2.code) {
          case "invalid_type":
            return `Invalid input: expected ${issue2.expected}, received ${parsedType(issue2.input)}`;
          case "invalid_value":
            if (issue2.values.length === 1)
              return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
            return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
          case "too_big": {
            const adj = issue2.inclusive ? "<=" : "<";
            const sizing = getSizing(issue2.origin);
            if (sizing)
              return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
            return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue2.inclusive ? ">=" : ">";
            const sizing = getSizing(issue2.origin);
            if (sizing) {
              return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
            }
            return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue2;
            if (_issue.format === "starts_with") {
              return `Invalid string: must start with "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Invalid string: must end with "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Invalid string: must include "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Invalid string: must match pattern ${_issue.pattern}`;
            return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
          }
          case "not_multiple_of":
            return `Invalid number: must be a multiple of ${issue2.divisor}`;
          case "unrecognized_keys":
            return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
          case "invalid_key":
            return `Invalid key in ${issue2.origin}`;
          case "invalid_union":
            return "Invalid input";
          case "invalid_element":
            return `Invalid value in ${issue2.origin}`;
          default:
            return `Invalid input`;
        }
      };
    };
  }
});

// node_modules/zod/v4/locales/index.js
var init_locales = __esm({
  "node_modules/zod/v4/locales/index.js"() {
  }
});

// node_modules/zod/v4/core/registries.js
function registry() {
  return new $ZodRegistry();
}
var $ZodRegistry, globalRegistry;
var init_registries = __esm({
  "node_modules/zod/v4/core/registries.js"() {
    $ZodRegistry = class {
      constructor() {
        this._map = /* @__PURE__ */ new Map();
        this._idmap = /* @__PURE__ */ new Map();
      }
      add(schema, ..._meta) {
        const meta = _meta[0];
        this._map.set(schema, meta);
        if (meta && typeof meta === "object" && "id" in meta) {
          if (this._idmap.has(meta.id)) {
            throw new Error(`ID ${meta.id} already exists in the registry`);
          }
          this._idmap.set(meta.id, schema);
        }
        return this;
      }
      clear() {
        this._map = /* @__PURE__ */ new Map();
        this._idmap = /* @__PURE__ */ new Map();
        return this;
      }
      remove(schema) {
        const meta = this._map.get(schema);
        if (meta && typeof meta === "object" && "id" in meta) {
          this._idmap.delete(meta.id);
        }
        this._map.delete(schema);
        return this;
      }
      get(schema) {
        const p = schema._zod.parent;
        if (p) {
          const pm = { ...this.get(p) ?? {} };
          delete pm.id;
          return { ...pm, ...this._map.get(schema) };
        }
        return this._map.get(schema);
      }
      has(schema) {
        return this._map.has(schema);
      }
    };
    globalRegistry = /* @__PURE__ */ registry();
  }
});

// node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
var init_api = __esm({
  "node_modules/zod/v4/core/api.js"() {
    init_checks();
    init_util();
  }
});

// node_modules/zod/v4/core/function.js
var init_function = __esm({
  "node_modules/zod/v4/core/function.js"() {
  }
});

// node_modules/zod/v4/core/to-json-schema.js
var init_to_json_schema = __esm({
  "node_modules/zod/v4/core/to-json-schema.js"() {
  }
});

// node_modules/zod/v4/core/json-schema.js
var init_json_schema = __esm({
  "node_modules/zod/v4/core/json-schema.js"() {
  }
});

// node_modules/zod/v4/core/index.js
var init_core2 = __esm({
  "node_modules/zod/v4/core/index.js"() {
    init_core();
    init_parse();
    init_errors();
    init_schemas();
    init_checks();
    init_versions();
    init_util();
    init_regexes();
    init_locales();
    init_registries();
    init_doc();
    init_function();
    init_api();
    init_to_json_schema();
    init_json_schema();
  }
});

// node_modules/zod/v4/mini/parse.js
var init_parse2 = __esm({
  "node_modules/zod/v4/mini/parse.js"() {
    init_core2();
  }
});

// node_modules/zod/v4/mini/schemas.js
var init_schemas2 = __esm({
  "node_modules/zod/v4/mini/schemas.js"() {
  }
});

// node_modules/zod/v4/mini/checks.js
var init_checks2 = __esm({
  "node_modules/zod/v4/mini/checks.js"() {
  }
});

// node_modules/zod/v4/mini/iso.js
var init_iso = __esm({
  "node_modules/zod/v4/mini/iso.js"() {
  }
});

// node_modules/zod/v4/mini/coerce.js
var init_coerce = __esm({
  "node_modules/zod/v4/mini/coerce.js"() {
  }
});

// node_modules/zod/v4/mini/external.js
var init_external = __esm({
  "node_modules/zod/v4/mini/external.js"() {
    init_core2();
    init_parse2();
    init_schemas2();
    init_checks2();
    init_locales();
    init_iso();
    init_coerce();
  }
});

// node_modules/zod/v4/mini/index.js
var init_mini = __esm({
  "node_modules/zod/v4/mini/index.js"() {
    init_external();
  }
});

// node_modules/zod/v4-mini/index.js
var init_v4_mini = __esm({
  "node_modules/zod/v4-mini/index.js"() {
    init_mini();
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
function isZ4Schema(s) {
  const schema = s;
  return !!schema._zod;
}
function safeParse2(schema, data) {
  if (isZ4Schema(schema)) {
    const result2 = safeParse(schema, data);
    return result2;
  }
  const v3Schema = schema;
  const result = v3Schema.safeParse(data);
  return result;
}
function getObjectShape(schema) {
  if (!schema)
    return void 0;
  let rawShape;
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    rawShape = v4Schema._zod?.def?.shape;
  } else {
    const v3Schema = schema;
    rawShape = v3Schema.shape;
  }
  if (!rawShape)
    return void 0;
  if (typeof rawShape === "function") {
    try {
      return rawShape();
    } catch {
      return void 0;
    }
  }
  return rawShape;
}
function getLiteralValue(schema) {
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    const def2 = v4Schema._zod?.def;
    if (def2) {
      if (def2.value !== void 0)
        return def2.value;
      if (Array.isArray(def2.values) && def2.values.length > 0) {
        return def2.values[0];
      }
    }
  }
  const v3Schema = schema;
  const def = v3Schema._def;
  if (def) {
    if (def.value !== void 0)
      return def.value;
    if (Array.isArray(def.values) && def.values.length > 0) {
      return def.values[0];
    }
  }
  const directValue = schema.value;
  if (directValue !== void 0)
    return directValue;
  return void 0;
}
var init_zod_compat = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js"() {
    init_v4_mini();
  }
});

// node_modules/zod/v4/classic/checks.js
var init_checks3 = __esm({
  "node_modules/zod/v4/classic/checks.js"() {
    init_core2();
  }
});

// node_modules/zod/v4/classic/iso.js
var iso_exports2 = {};
__export(iso_exports2, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
function date2(params) {
  return _isoDate(ZodISODate, params);
}
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}
var ZodISODateTime, ZodISODate, ZodISOTime, ZodISODuration;
var init_iso2 = __esm({
  "node_modules/zod/v4/classic/iso.js"() {
    init_core2();
    init_schemas3();
    ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
      $ZodISODateTime.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
      $ZodISODate.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
      $ZodISOTime.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
      $ZodISODuration.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
  }
});

// node_modules/zod/v4/classic/errors.js
var initializer2, ZodError, ZodRealError;
var init_errors2 = __esm({
  "node_modules/zod/v4/classic/errors.js"() {
    init_core2();
    init_core2();
    initializer2 = (inst, issues) => {
      $ZodError.init(inst, issues);
      inst.name = "ZodError";
      Object.defineProperties(inst, {
        format: {
          value: (mapper) => formatError(inst, mapper)
          // enumerable: false,
        },
        flatten: {
          value: (mapper) => flattenError(inst, mapper)
          // enumerable: false,
        },
        addIssue: {
          value: (issue2) => inst.issues.push(issue2)
          // enumerable: false,
        },
        addIssues: {
          value: (issues2) => inst.issues.push(...issues2)
          // enumerable: false,
        },
        isEmpty: {
          get() {
            return inst.issues.length === 0;
          }
          // enumerable: false,
        }
      });
    };
    ZodError = $constructor("ZodError", initializer2);
    ZodRealError = $constructor("ZodError", initializer2, {
      Parent: Error
    });
  }
});

// node_modules/zod/v4/classic/parse.js
var parse2, parseAsync2, safeParse3, safeParseAsync2;
var init_parse3 = __esm({
  "node_modules/zod/v4/classic/parse.js"() {
    init_core2();
    init_errors2();
    parse2 = /* @__PURE__ */ _parse(ZodRealError);
    parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
    safeParse3 = /* @__PURE__ */ _safeParse(ZodRealError);
    safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
  }
});

// node_modules/zod/v4/classic/schemas.js
function string2(params) {
  return _string(ZodString, params);
}
function number2(params) {
  return _number(ZodNumber, params);
}
function int(params) {
  return _int(ZodNumberFormat, params);
}
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
function _null3(params) {
  return _null2(ZodNull, params);
}
function unknown() {
  return _unknown(ZodUnknown);
}
function never(params) {
  return _never(ZodNever, params);
}
function array(element, params) {
  return _array(ZodArray, element, params);
}
function object2(shape, params) {
  const def = {
    type: "object",
    get shape() {
      util_exports.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    get shape() {
      util_exports.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...util_exports.normalizeParams(params)
  });
}
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
function record(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  const ch = check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
function preprocess(fn, schema) {
  return pipe(transform(fn), schema);
}
var ZodType, _ZodString, ZodString, ZodStringFormat, ZodEmail, ZodGUID, ZodUUID, ZodURL, ZodEmoji, ZodNanoID, ZodCUID, ZodCUID2, ZodULID, ZodXID, ZodKSUID, ZodIPv4, ZodIPv6, ZodCIDRv4, ZodCIDRv6, ZodBase64, ZodBase64URL, ZodE164, ZodJWT, ZodNumber, ZodNumberFormat, ZodBoolean, ZodNull, ZodUnknown, ZodNever, ZodArray, ZodObject, ZodUnion, ZodDiscriminatedUnion, ZodIntersection, ZodRecord, ZodEnum, ZodLiteral, ZodTransform, ZodOptional, ZodNullable, ZodDefault, ZodPrefault, ZodNonOptional, ZodCatch, ZodPipe, ZodReadonly, ZodCustom;
var init_schemas3 = __esm({
  "node_modules/zod/v4/classic/schemas.js"() {
    init_core2();
    init_core2();
    init_checks3();
    init_iso2();
    init_parse3();
    ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
      $ZodType.init(inst, def);
      inst.def = def;
      Object.defineProperty(inst, "_def", { value: def });
      inst.check = (...checks) => {
        return inst.clone(
          {
            ...def,
            checks: [
              ...def.checks ?? [],
              ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
            ]
          }
          // { parent: true }
        );
      };
      inst.clone = (def2, params) => clone(inst, def2, params);
      inst.brand = () => inst;
      inst.register = ((reg, meta) => {
        reg.add(inst, meta);
        return inst;
      });
      inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
      inst.safeParse = (data, params) => safeParse3(inst, data, params);
      inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
      inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
      inst.spa = inst.safeParseAsync;
      inst.refine = (check2, params) => inst.check(refine(check2, params));
      inst.superRefine = (refinement) => inst.check(superRefine(refinement));
      inst.overwrite = (fn) => inst.check(_overwrite(fn));
      inst.optional = () => optional(inst);
      inst.nullable = () => nullable(inst);
      inst.nullish = () => optional(nullable(inst));
      inst.nonoptional = (params) => nonoptional(inst, params);
      inst.array = () => array(inst);
      inst.or = (arg) => union([inst, arg]);
      inst.and = (arg) => intersection(inst, arg);
      inst.transform = (tx) => pipe(inst, transform(tx));
      inst.default = (def2) => _default(inst, def2);
      inst.prefault = (def2) => prefault(inst, def2);
      inst.catch = (params) => _catch(inst, params);
      inst.pipe = (target) => pipe(inst, target);
      inst.readonly = () => readonly(inst);
      inst.describe = (description) => {
        const cl = inst.clone();
        globalRegistry.add(cl, { description });
        return cl;
      };
      Object.defineProperty(inst, "description", {
        get() {
          return globalRegistry.get(inst)?.description;
        },
        configurable: true
      });
      inst.meta = (...args) => {
        if (args.length === 0) {
          return globalRegistry.get(inst);
        }
        const cl = inst.clone();
        globalRegistry.add(cl, args[0]);
        return cl;
      };
      inst.isOptional = () => inst.safeParse(void 0).success;
      inst.isNullable = () => inst.safeParse(null).success;
      return inst;
    });
    _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
      $ZodString.init(inst, def);
      ZodType.init(inst, def);
      const bag = inst._zod.bag;
      inst.format = bag.format ?? null;
      inst.minLength = bag.minimum ?? null;
      inst.maxLength = bag.maximum ?? null;
      inst.regex = (...args) => inst.check(_regex(...args));
      inst.includes = (...args) => inst.check(_includes(...args));
      inst.startsWith = (...args) => inst.check(_startsWith(...args));
      inst.endsWith = (...args) => inst.check(_endsWith(...args));
      inst.min = (...args) => inst.check(_minLength(...args));
      inst.max = (...args) => inst.check(_maxLength(...args));
      inst.length = (...args) => inst.check(_length(...args));
      inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
      inst.lowercase = (params) => inst.check(_lowercase(params));
      inst.uppercase = (params) => inst.check(_uppercase(params));
      inst.trim = () => inst.check(_trim());
      inst.normalize = (...args) => inst.check(_normalize(...args));
      inst.toLowerCase = () => inst.check(_toLowerCase());
      inst.toUpperCase = () => inst.check(_toUpperCase());
    });
    ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
      $ZodString.init(inst, def);
      _ZodString.init(inst, def);
      inst.email = (params) => inst.check(_email(ZodEmail, params));
      inst.url = (params) => inst.check(_url(ZodURL, params));
      inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
      inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
      inst.guid = (params) => inst.check(_guid(ZodGUID, params));
      inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
      inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
      inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
      inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
      inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
      inst.guid = (params) => inst.check(_guid(ZodGUID, params));
      inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
      inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
      inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
      inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
      inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
      inst.xid = (params) => inst.check(_xid(ZodXID, params));
      inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
      inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
      inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
      inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
      inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
      inst.e164 = (params) => inst.check(_e164(ZodE164, params));
      inst.datetime = (params) => inst.check(datetime2(params));
      inst.date = (params) => inst.check(date2(params));
      inst.time = (params) => inst.check(time2(params));
      inst.duration = (params) => inst.check(duration2(params));
    });
    ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      _ZodString.init(inst, def);
    });
    ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
      $ZodEmail.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
      $ZodGUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
      $ZodUUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
      $ZodURL.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
      $ZodEmoji.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
      $ZodNanoID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
      $ZodCUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
      $ZodCUID2.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
      $ZodULID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
      $ZodXID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
      $ZodKSUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
      $ZodIPv4.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
      $ZodIPv6.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
      $ZodCIDRv4.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
      $ZodCIDRv6.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
      $ZodBase64.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
      $ZodBase64URL.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
      $ZodE164.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
      $ZodJWT.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
      $ZodNumber.init(inst, def);
      ZodType.init(inst, def);
      inst.gt = (value, params) => inst.check(_gt(value, params));
      inst.gte = (value, params) => inst.check(_gte(value, params));
      inst.min = (value, params) => inst.check(_gte(value, params));
      inst.lt = (value, params) => inst.check(_lt(value, params));
      inst.lte = (value, params) => inst.check(_lte(value, params));
      inst.max = (value, params) => inst.check(_lte(value, params));
      inst.int = (params) => inst.check(int(params));
      inst.safe = (params) => inst.check(int(params));
      inst.positive = (params) => inst.check(_gt(0, params));
      inst.nonnegative = (params) => inst.check(_gte(0, params));
      inst.negative = (params) => inst.check(_lt(0, params));
      inst.nonpositive = (params) => inst.check(_lte(0, params));
      inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
      inst.step = (value, params) => inst.check(_multipleOf(value, params));
      inst.finite = () => inst;
      const bag = inst._zod.bag;
      inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
      inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
      inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
      inst.isFinite = true;
      inst.format = bag.format ?? null;
    });
    ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
      $ZodNumberFormat.init(inst, def);
      ZodNumber.init(inst, def);
    });
    ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
      $ZodBoolean.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
      $ZodNull.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
      $ZodUnknown.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
      $ZodNever.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
      $ZodArray.init(inst, def);
      ZodType.init(inst, def);
      inst.element = def.element;
      inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
      inst.nonempty = (params) => inst.check(_minLength(1, params));
      inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
      inst.length = (len, params) => inst.check(_length(len, params));
      inst.unwrap = () => inst.element;
    });
    ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
      $ZodObject.init(inst, def);
      ZodType.init(inst, def);
      util_exports.defineLazy(inst, "shape", () => def.shape);
      inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
      inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
      inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
      inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
      inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
      inst.strip = () => inst.clone({ ...inst._zod.def, catchall: void 0 });
      inst.extend = (incoming) => {
        return util_exports.extend(inst, incoming);
      };
      inst.merge = (other) => util_exports.merge(inst, other);
      inst.pick = (mask) => util_exports.pick(inst, mask);
      inst.omit = (mask) => util_exports.omit(inst, mask);
      inst.partial = (...args) => util_exports.partial(ZodOptional, inst, args[0]);
      inst.required = (...args) => util_exports.required(ZodNonOptional, inst, args[0]);
    });
    ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
      $ZodUnion.init(inst, def);
      ZodType.init(inst, def);
      inst.options = def.options;
    });
    ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
      ZodUnion.init(inst, def);
      $ZodDiscriminatedUnion.init(inst, def);
    });
    ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
      $ZodIntersection.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
      $ZodRecord.init(inst, def);
      ZodType.init(inst, def);
      inst.keyType = def.keyType;
      inst.valueType = def.valueType;
    });
    ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
      $ZodEnum.init(inst, def);
      ZodType.init(inst, def);
      inst.enum = def.entries;
      inst.options = Object.values(def.entries);
      const keys = new Set(Object.keys(def.entries));
      inst.extract = (values, params) => {
        const newEntries = {};
        for (const value of values) {
          if (keys.has(value)) {
            newEntries[value] = def.entries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new ZodEnum({
          ...def,
          checks: [],
          ...util_exports.normalizeParams(params),
          entries: newEntries
        });
      };
      inst.exclude = (values, params) => {
        const newEntries = { ...def.entries };
        for (const value of values) {
          if (keys.has(value)) {
            delete newEntries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new ZodEnum({
          ...def,
          checks: [],
          ...util_exports.normalizeParams(params),
          entries: newEntries
        });
      };
    });
    ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
      $ZodLiteral.init(inst, def);
      ZodType.init(inst, def);
      inst.values = new Set(def.values);
      Object.defineProperty(inst, "value", {
        get() {
          if (def.values.length > 1) {
            throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
          }
          return def.values[0];
        }
      });
    });
    ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
      $ZodTransform.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        payload.addIssue = (issue2) => {
          if (typeof issue2 === "string") {
            payload.issues.push(util_exports.issue(issue2, payload.value, def));
          } else {
            const _issue = issue2;
            if (_issue.fatal)
              _issue.continue = false;
            _issue.code ?? (_issue.code = "custom");
            _issue.input ?? (_issue.input = payload.value);
            _issue.inst ?? (_issue.inst = inst);
            _issue.continue ?? (_issue.continue = true);
            payload.issues.push(util_exports.issue(_issue));
          }
        };
        const output = def.transform(payload.value, payload);
        if (output instanceof Promise) {
          return output.then((output2) => {
            payload.value = output2;
            return payload;
          });
        }
        payload.value = output;
        return payload;
      };
    });
    ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
      $ZodOptional.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
      $ZodNullable.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
      $ZodDefault.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeDefault = inst.unwrap;
    });
    ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
      $ZodPrefault.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
      $ZodNonOptional.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
      $ZodCatch.init(inst, def);
      ZodType.init(inst, def);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeCatch = inst.unwrap;
    });
    ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
      $ZodPipe.init(inst, def);
      ZodType.init(inst, def);
      inst.in = def.in;
      inst.out = def.out;
    });
    ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
      $ZodReadonly.init(inst, def);
      ZodType.init(inst, def);
    });
    ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
      $ZodCustom.init(inst, def);
      ZodType.init(inst, def);
    });
  }
});

// node_modules/zod/v4/classic/compat.js
var init_compat = __esm({
  "node_modules/zod/v4/classic/compat.js"() {
  }
});

// node_modules/zod/v4/classic/coerce.js
var init_coerce2 = __esm({
  "node_modules/zod/v4/classic/coerce.js"() {
  }
});

// node_modules/zod/v4/classic/external.js
var init_external2 = __esm({
  "node_modules/zod/v4/classic/external.js"() {
    init_core2();
    init_schemas3();
    init_checks3();
    init_errors2();
    init_parse3();
    init_compat();
    init_core2();
    init_en();
    init_locales();
    init_iso2();
    init_coerce2();
    config(en_default());
  }
});

// node_modules/zod/v4/classic/index.js
var init_classic = __esm({
  "node_modules/zod/v4/classic/index.js"() {
    init_external2();
  }
});

// node_modules/zod/v4/index.js
var init_v4 = __esm({
  "node_modules/zod/v4/index.js"() {
    init_classic();
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
var LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, RELATED_TASK_META_KEY, JSONRPC_VERSION, AssertObjectSchema, ProgressTokenSchema, CursorSchema, TaskCreationParamsSchema, TaskMetadataSchema, RelatedTaskMetadataSchema, RequestMetaSchema, BaseRequestParamsSchema, TaskAugmentedRequestParamsSchema, isTaskAugmentedRequestParams, RequestSchema, NotificationsParamsSchema, NotificationSchema, ResultSchema, RequestIdSchema, JSONRPCRequestSchema, isJSONRPCRequest, JSONRPCNotificationSchema, isJSONRPCNotification, JSONRPCResultResponseSchema, isJSONRPCResultResponse, ErrorCode, JSONRPCErrorResponseSchema, isJSONRPCErrorResponse, JSONRPCMessageSchema, JSONRPCResponseSchema, EmptyResultSchema, CancelledNotificationParamsSchema, CancelledNotificationSchema, IconSchema, IconsSchema, BaseMetadataSchema, ImplementationSchema, FormElicitationCapabilitySchema, ElicitationCapabilitySchema, ClientTasksCapabilitySchema, ServerTasksCapabilitySchema, ClientCapabilitiesSchema, InitializeRequestParamsSchema, InitializeRequestSchema, ServerCapabilitiesSchema, InitializeResultSchema, InitializedNotificationSchema, PingRequestSchema, ProgressSchema, ProgressNotificationParamsSchema, ProgressNotificationSchema, PaginatedRequestParamsSchema, PaginatedRequestSchema, PaginatedResultSchema, TaskStatusSchema, TaskSchema, CreateTaskResultSchema, TaskStatusNotificationParamsSchema, TaskStatusNotificationSchema, GetTaskRequestSchema, GetTaskResultSchema, GetTaskPayloadRequestSchema, GetTaskPayloadResultSchema, ListTasksRequestSchema, ListTasksResultSchema, CancelTaskRequestSchema, CancelTaskResultSchema, ResourceContentsSchema, TextResourceContentsSchema, Base64Schema, BlobResourceContentsSchema, RoleSchema, AnnotationsSchema, ResourceSchema, ResourceTemplateSchema, ListResourcesRequestSchema, ListResourcesResultSchema, ListResourceTemplatesRequestSchema, ListResourceTemplatesResultSchema, ResourceRequestParamsSchema, ReadResourceRequestParamsSchema, ReadResourceRequestSchema, ReadResourceResultSchema, ResourceListChangedNotificationSchema, SubscribeRequestParamsSchema, SubscribeRequestSchema, UnsubscribeRequestParamsSchema, UnsubscribeRequestSchema, ResourceUpdatedNotificationParamsSchema, ResourceUpdatedNotificationSchema, PromptArgumentSchema, PromptSchema, ListPromptsRequestSchema, ListPromptsResultSchema, GetPromptRequestParamsSchema, GetPromptRequestSchema, TextContentSchema, ImageContentSchema, AudioContentSchema, ToolUseContentSchema, EmbeddedResourceSchema, ResourceLinkSchema, ContentBlockSchema, PromptMessageSchema, GetPromptResultSchema, PromptListChangedNotificationSchema, ToolAnnotationsSchema, ToolExecutionSchema, ToolSchema, ListToolsRequestSchema, ListToolsResultSchema, CallToolResultSchema, CompatibilityCallToolResultSchema, CallToolRequestParamsSchema, CallToolRequestSchema, ToolListChangedNotificationSchema, ListChangedOptionsBaseSchema, LoggingLevelSchema, SetLevelRequestParamsSchema, SetLevelRequestSchema, LoggingMessageNotificationParamsSchema, LoggingMessageNotificationSchema, ModelHintSchema, ModelPreferencesSchema, ToolChoiceSchema, ToolResultContentSchema, SamplingContentSchema, SamplingMessageContentBlockSchema, SamplingMessageSchema, CreateMessageRequestParamsSchema, CreateMessageRequestSchema, CreateMessageResultSchema, CreateMessageResultWithToolsSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema, UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema, LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema, EnumSchemaSchema, PrimitiveSchemaDefinitionSchema, ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema, ElicitRequestParamsSchema, ElicitRequestSchema, ElicitationCompleteNotificationParamsSchema, ElicitationCompleteNotificationSchema, ElicitResultSchema, ResourceTemplateReferenceSchema, PromptReferenceSchema, CompleteRequestParamsSchema, CompleteRequestSchema, CompleteResultSchema, RootSchema, ListRootsRequestSchema, ListRootsResultSchema, RootsListChangedNotificationSchema, ClientRequestSchema, ClientNotificationSchema, ClientResultSchema, ServerRequestSchema, ServerNotificationSchema, ServerResultSchema, McpError, UrlElicitationRequiredError;
var init_types = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/types.js"() {
    init_v4();
    LATEST_PROTOCOL_VERSION = "2025-11-25";
    SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
    RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
    JSONRPC_VERSION = "2.0";
    AssertObjectSchema = custom((v) => v !== null && (typeof v === "object" || typeof v === "function"));
    ProgressTokenSchema = union([string2(), number2().int()]);
    CursorSchema = string2();
    TaskCreationParamsSchema = looseObject({
      /**
       * Time in milliseconds to keep task results available after completion.
       * If null, the task has unlimited lifetime until manually cleaned up.
       */
      ttl: union([number2(), _null3()]).optional(),
      /**
       * Time in milliseconds to wait between task status requests.
       */
      pollInterval: number2().optional()
    });
    TaskMetadataSchema = object2({
      ttl: number2().optional()
    });
    RelatedTaskMetadataSchema = object2({
      taskId: string2()
    });
    RequestMetaSchema = looseObject({
      /**
       * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
       */
      progressToken: ProgressTokenSchema.optional(),
      /**
       * If specified, this request is related to the provided task.
       */
      [RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
    });
    BaseRequestParamsSchema = object2({
      /**
       * See [General fields: `_meta`](/specification/draft/basic/index#meta) for notes on `_meta` usage.
       */
      _meta: RequestMetaSchema.optional()
    });
    TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * If specified, the caller is requesting task-augmented execution for this request.
       * The request will return a CreateTaskResult immediately, and the actual result can be
       * retrieved later via tasks/result.
       *
       * Task augmentation is subject to capability negotiation - receivers MUST declare support
       * for task augmentation of specific request types in their capabilities.
       */
      task: TaskMetadataSchema.optional()
    });
    isTaskAugmentedRequestParams = (value) => TaskAugmentedRequestParamsSchema.safeParse(value).success;
    RequestSchema = object2({
      method: string2(),
      params: BaseRequestParamsSchema.loose().optional()
    });
    NotificationsParamsSchema = object2({
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: RequestMetaSchema.optional()
    });
    NotificationSchema = object2({
      method: string2(),
      params: NotificationsParamsSchema.loose().optional()
    });
    ResultSchema = looseObject({
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: RequestMetaSchema.optional()
    });
    RequestIdSchema = union([string2(), number2().int()]);
    JSONRPCRequestSchema = object2({
      jsonrpc: literal(JSONRPC_VERSION),
      id: RequestIdSchema,
      ...RequestSchema.shape
    }).strict();
    isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success;
    JSONRPCNotificationSchema = object2({
      jsonrpc: literal(JSONRPC_VERSION),
      ...NotificationSchema.shape
    }).strict();
    isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success;
    JSONRPCResultResponseSchema = object2({
      jsonrpc: literal(JSONRPC_VERSION),
      id: RequestIdSchema,
      result: ResultSchema
    }).strict();
    isJSONRPCResultResponse = (value) => JSONRPCResultResponseSchema.safeParse(value).success;
    (function(ErrorCode2) {
      ErrorCode2[ErrorCode2["ConnectionClosed"] = -32e3] = "ConnectionClosed";
      ErrorCode2[ErrorCode2["RequestTimeout"] = -32001] = "RequestTimeout";
      ErrorCode2[ErrorCode2["ParseError"] = -32700] = "ParseError";
      ErrorCode2[ErrorCode2["InvalidRequest"] = -32600] = "InvalidRequest";
      ErrorCode2[ErrorCode2["MethodNotFound"] = -32601] = "MethodNotFound";
      ErrorCode2[ErrorCode2["InvalidParams"] = -32602] = "InvalidParams";
      ErrorCode2[ErrorCode2["InternalError"] = -32603] = "InternalError";
      ErrorCode2[ErrorCode2["UrlElicitationRequired"] = -32042] = "UrlElicitationRequired";
    })(ErrorCode || (ErrorCode = {}));
    JSONRPCErrorResponseSchema = object2({
      jsonrpc: literal(JSONRPC_VERSION),
      id: RequestIdSchema.optional(),
      error: object2({
        /**
         * The error type that occurred.
         */
        code: number2().int(),
        /**
         * A short description of the error. The message SHOULD be limited to a concise single sentence.
         */
        message: string2(),
        /**
         * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
         */
        data: unknown().optional()
      })
    }).strict();
    isJSONRPCErrorResponse = (value) => JSONRPCErrorResponseSchema.safeParse(value).success;
    JSONRPCMessageSchema = union([
      JSONRPCRequestSchema,
      JSONRPCNotificationSchema,
      JSONRPCResultResponseSchema,
      JSONRPCErrorResponseSchema
    ]);
    JSONRPCResponseSchema = union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
    EmptyResultSchema = ResultSchema.strict();
    CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
      /**
       * The ID of the request to cancel.
       *
       * This MUST correspond to the ID of a request previously issued in the same direction.
       */
      requestId: RequestIdSchema.optional(),
      /**
       * An optional string describing the reason for the cancellation. This MAY be logged or presented to the user.
       */
      reason: string2().optional()
    });
    CancelledNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/cancelled"),
      params: CancelledNotificationParamsSchema
    });
    IconSchema = object2({
      /**
       * URL or data URI for the icon.
       */
      src: string2(),
      /**
       * Optional MIME type for the icon.
       */
      mimeType: string2().optional(),
      /**
       * Optional array of strings that specify sizes at which the icon can be used.
       * Each string should be in WxH format (e.g., `"48x48"`, `"96x96"`) or `"any"` for scalable formats like SVG.
       *
       * If not provided, the client should assume that the icon can be used at any size.
       */
      sizes: array(string2()).optional(),
      /**
       * Optional specifier for the theme this icon is designed for. `light` indicates
       * the icon is designed to be used with a light background, and `dark` indicates
       * the icon is designed to be used with a dark background.
       *
       * If not provided, the client should assume the icon can be used with any theme.
       */
      theme: _enum(["light", "dark"]).optional()
    });
    IconsSchema = object2({
      /**
       * Optional set of sized icons that the client can display in a user interface.
       *
       * Clients that support rendering icons MUST support at least the following MIME types:
       * - `image/png` - PNG images (safe, universal compatibility)
       * - `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)
       *
       * Clients that support rendering icons SHOULD also support:
       * - `image/svg+xml` - SVG images (scalable but requires security precautions)
       * - `image/webp` - WebP images (modern, efficient format)
       */
      icons: array(IconSchema).optional()
    });
    BaseMetadataSchema = object2({
      /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
      name: string2(),
      /**
       * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
       * even by those unfamiliar with domain-specific terminology.
       *
       * If not provided, the name should be used for display (except for Tool,
       * where `annotations.title` should be given precedence over using `name`,
       * if present).
       */
      title: string2().optional()
    });
    ImplementationSchema = BaseMetadataSchema.extend({
      ...BaseMetadataSchema.shape,
      ...IconsSchema.shape,
      version: string2(),
      /**
       * An optional URL of the website for this implementation.
       */
      websiteUrl: string2().optional(),
      /**
       * An optional human-readable description of what this implementation does.
       *
       * This can be used by clients or servers to provide context about their purpose
       * and capabilities. For example, a server might describe the types of resources
       * or tools it provides, while a client might describe its intended use case.
       */
      description: string2().optional()
    });
    FormElicitationCapabilitySchema = intersection(object2({
      applyDefaults: boolean2().optional()
    }), record(string2(), unknown()));
    ElicitationCapabilitySchema = preprocess((value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (Object.keys(value).length === 0) {
          return { form: {} };
        }
      }
      return value;
    }, intersection(object2({
      form: FormElicitationCapabilitySchema.optional(),
      url: AssertObjectSchema.optional()
    }), record(string2(), unknown()).optional()));
    ClientTasksCapabilitySchema = looseObject({
      /**
       * Present if the client supports listing tasks.
       */
      list: AssertObjectSchema.optional(),
      /**
       * Present if the client supports cancelling tasks.
       */
      cancel: AssertObjectSchema.optional(),
      /**
       * Capabilities for task creation on specific request types.
       */
      requests: looseObject({
        /**
         * Task support for sampling requests.
         */
        sampling: looseObject({
          createMessage: AssertObjectSchema.optional()
        }).optional(),
        /**
         * Task support for elicitation requests.
         */
        elicitation: looseObject({
          create: AssertObjectSchema.optional()
        }).optional()
      }).optional()
    });
    ServerTasksCapabilitySchema = looseObject({
      /**
       * Present if the server supports listing tasks.
       */
      list: AssertObjectSchema.optional(),
      /**
       * Present if the server supports cancelling tasks.
       */
      cancel: AssertObjectSchema.optional(),
      /**
       * Capabilities for task creation on specific request types.
       */
      requests: looseObject({
        /**
         * Task support for tool requests.
         */
        tools: looseObject({
          call: AssertObjectSchema.optional()
        }).optional()
      }).optional()
    });
    ClientCapabilitiesSchema = object2({
      /**
       * Experimental, non-standard capabilities that the client supports.
       */
      experimental: record(string2(), AssertObjectSchema).optional(),
      /**
       * Present if the client supports sampling from an LLM.
       */
      sampling: object2({
        /**
         * Present if the client supports context inclusion via includeContext parameter.
         * If not declared, servers SHOULD only use `includeContext: "none"` (or omit it).
         */
        context: AssertObjectSchema.optional(),
        /**
         * Present if the client supports tool use via tools and toolChoice parameters.
         */
        tools: AssertObjectSchema.optional()
      }).optional(),
      /**
       * Present if the client supports eliciting user input.
       */
      elicitation: ElicitationCapabilitySchema.optional(),
      /**
       * Present if the client supports listing roots.
       */
      roots: object2({
        /**
         * Whether the client supports issuing notifications for changes to the roots list.
         */
        listChanged: boolean2().optional()
      }).optional(),
      /**
       * Present if the client supports task creation.
       */
      tasks: ClientTasksCapabilitySchema.optional()
    });
    InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
       */
      protocolVersion: string2(),
      capabilities: ClientCapabilitiesSchema,
      clientInfo: ImplementationSchema
    });
    InitializeRequestSchema = RequestSchema.extend({
      method: literal("initialize"),
      params: InitializeRequestParamsSchema
    });
    ServerCapabilitiesSchema = object2({
      /**
       * Experimental, non-standard capabilities that the server supports.
       */
      experimental: record(string2(), AssertObjectSchema).optional(),
      /**
       * Present if the server supports sending log messages to the client.
       */
      logging: AssertObjectSchema.optional(),
      /**
       * Present if the server supports sending completions to the client.
       */
      completions: AssertObjectSchema.optional(),
      /**
       * Present if the server offers any prompt templates.
       */
      prompts: object2({
        /**
         * Whether this server supports issuing notifications for changes to the prompt list.
         */
        listChanged: boolean2().optional()
      }).optional(),
      /**
       * Present if the server offers any resources to read.
       */
      resources: object2({
        /**
         * Whether this server supports clients subscribing to resource updates.
         */
        subscribe: boolean2().optional(),
        /**
         * Whether this server supports issuing notifications for changes to the resource list.
         */
        listChanged: boolean2().optional()
      }).optional(),
      /**
       * Present if the server offers any tools to call.
       */
      tools: object2({
        /**
         * Whether this server supports issuing notifications for changes to the tool list.
         */
        listChanged: boolean2().optional()
      }).optional(),
      /**
       * Present if the server supports task creation.
       */
      tasks: ServerTasksCapabilitySchema.optional()
    });
    InitializeResultSchema = ResultSchema.extend({
      /**
       * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
       */
      protocolVersion: string2(),
      capabilities: ServerCapabilitiesSchema,
      serverInfo: ImplementationSchema,
      /**
       * Instructions describing how to use the server and its features.
       *
       * This can be used by clients to improve the LLM's understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt.
       */
      instructions: string2().optional()
    });
    InitializedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/initialized"),
      params: NotificationsParamsSchema.optional()
    });
    PingRequestSchema = RequestSchema.extend({
      method: literal("ping"),
      params: BaseRequestParamsSchema.optional()
    });
    ProgressSchema = object2({
      /**
       * The progress thus far. This should increase every time progress is made, even if the total is unknown.
       */
      progress: number2(),
      /**
       * Total number of items to process (or total progress required), if known.
       */
      total: optional(number2()),
      /**
       * An optional message describing the current progress.
       */
      message: optional(string2())
    });
    ProgressNotificationParamsSchema = object2({
      ...NotificationsParamsSchema.shape,
      ...ProgressSchema.shape,
      /**
       * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
       */
      progressToken: ProgressTokenSchema
    });
    ProgressNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/progress"),
      params: ProgressNotificationParamsSchema
    });
    PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * An opaque token representing the current pagination position.
       * If provided, the server should return results starting after this cursor.
       */
      cursor: CursorSchema.optional()
    });
    PaginatedRequestSchema = RequestSchema.extend({
      params: PaginatedRequestParamsSchema.optional()
    });
    PaginatedResultSchema = ResultSchema.extend({
      /**
       * An opaque token representing the pagination position after the last returned result.
       * If present, there may be more results available.
       */
      nextCursor: CursorSchema.optional()
    });
    TaskStatusSchema = _enum(["working", "input_required", "completed", "failed", "cancelled"]);
    TaskSchema = object2({
      taskId: string2(),
      status: TaskStatusSchema,
      /**
       * Time in milliseconds to keep task results available after completion.
       * If null, the task has unlimited lifetime until manually cleaned up.
       */
      ttl: union([number2(), _null3()]),
      /**
       * ISO 8601 timestamp when the task was created.
       */
      createdAt: string2(),
      /**
       * ISO 8601 timestamp when the task was last updated.
       */
      lastUpdatedAt: string2(),
      pollInterval: optional(number2()),
      /**
       * Optional diagnostic message for failed tasks or other status information.
       */
      statusMessage: optional(string2())
    });
    CreateTaskResultSchema = ResultSchema.extend({
      task: TaskSchema
    });
    TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema);
    TaskStatusNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/tasks/status"),
      params: TaskStatusNotificationParamsSchema
    });
    GetTaskRequestSchema = RequestSchema.extend({
      method: literal("tasks/get"),
      params: BaseRequestParamsSchema.extend({
        taskId: string2()
      })
    });
    GetTaskResultSchema = ResultSchema.merge(TaskSchema);
    GetTaskPayloadRequestSchema = RequestSchema.extend({
      method: literal("tasks/result"),
      params: BaseRequestParamsSchema.extend({
        taskId: string2()
      })
    });
    GetTaskPayloadResultSchema = ResultSchema.loose();
    ListTasksRequestSchema = PaginatedRequestSchema.extend({
      method: literal("tasks/list")
    });
    ListTasksResultSchema = PaginatedResultSchema.extend({
      tasks: array(TaskSchema)
    });
    CancelTaskRequestSchema = RequestSchema.extend({
      method: literal("tasks/cancel"),
      params: BaseRequestParamsSchema.extend({
        taskId: string2()
      })
    });
    CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
    ResourceContentsSchema = object2({
      /**
       * The URI of this resource.
       */
      uri: string2(),
      /**
       * The MIME type of this resource, if known.
       */
      mimeType: optional(string2()),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    TextResourceContentsSchema = ResourceContentsSchema.extend({
      /**
       * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
       */
      text: string2()
    });
    Base64Schema = string2().refine((val) => {
      try {
        atob(val);
        return true;
      } catch {
        return false;
      }
    }, { message: "Invalid Base64 string" });
    BlobResourceContentsSchema = ResourceContentsSchema.extend({
      /**
       * A base64-encoded string representing the binary data of the item.
       */
      blob: Base64Schema
    });
    RoleSchema = _enum(["user", "assistant"]);
    AnnotationsSchema = object2({
      /**
       * Intended audience(s) for the resource.
       */
      audience: array(RoleSchema).optional(),
      /**
       * Importance hint for the resource, from 0 (least) to 1 (most).
       */
      priority: number2().min(0).max(1).optional(),
      /**
       * ISO 8601 timestamp for the most recent modification.
       */
      lastModified: iso_exports2.datetime({ offset: true }).optional()
    });
    ResourceSchema = object2({
      ...BaseMetadataSchema.shape,
      ...IconsSchema.shape,
      /**
       * The URI of this resource.
       */
      uri: string2(),
      /**
       * A description of what this resource represents.
       *
       * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
       */
      description: optional(string2()),
      /**
       * The MIME type of this resource, if known.
       */
      mimeType: optional(string2()),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: optional(looseObject({}))
    });
    ResourceTemplateSchema = object2({
      ...BaseMetadataSchema.shape,
      ...IconsSchema.shape,
      /**
       * A URI template (according to RFC 6570) that can be used to construct resource URIs.
       */
      uriTemplate: string2(),
      /**
       * A description of what this template is for.
       *
       * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
       */
      description: optional(string2()),
      /**
       * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
       */
      mimeType: optional(string2()),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: optional(looseObject({}))
    });
    ListResourcesRequestSchema = PaginatedRequestSchema.extend({
      method: literal("resources/list")
    });
    ListResourcesResultSchema = PaginatedResultSchema.extend({
      resources: array(ResourceSchema)
    });
    ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
      method: literal("resources/templates/list")
    });
    ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
      resourceTemplates: array(ResourceTemplateSchema)
    });
    ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
       *
       * @format uri
       */
      uri: string2()
    });
    ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
    ReadResourceRequestSchema = RequestSchema.extend({
      method: literal("resources/read"),
      params: ReadResourceRequestParamsSchema
    });
    ReadResourceResultSchema = ResultSchema.extend({
      contents: array(union([TextResourceContentsSchema, BlobResourceContentsSchema]))
    });
    ResourceListChangedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/resources/list_changed"),
      params: NotificationsParamsSchema.optional()
    });
    SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
    SubscribeRequestSchema = RequestSchema.extend({
      method: literal("resources/subscribe"),
      params: SubscribeRequestParamsSchema
    });
    UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
    UnsubscribeRequestSchema = RequestSchema.extend({
      method: literal("resources/unsubscribe"),
      params: UnsubscribeRequestParamsSchema
    });
    ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
      /**
       * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
       */
      uri: string2()
    });
    ResourceUpdatedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/resources/updated"),
      params: ResourceUpdatedNotificationParamsSchema
    });
    PromptArgumentSchema = object2({
      /**
       * The name of the argument.
       */
      name: string2(),
      /**
       * A human-readable description of the argument.
       */
      description: optional(string2()),
      /**
       * Whether this argument must be provided.
       */
      required: optional(boolean2())
    });
    PromptSchema = object2({
      ...BaseMetadataSchema.shape,
      ...IconsSchema.shape,
      /**
       * An optional description of what this prompt provides
       */
      description: optional(string2()),
      /**
       * A list of arguments to use for templating the prompt.
       */
      arguments: optional(array(PromptArgumentSchema)),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: optional(looseObject({}))
    });
    ListPromptsRequestSchema = PaginatedRequestSchema.extend({
      method: literal("prompts/list")
    });
    ListPromptsResultSchema = PaginatedResultSchema.extend({
      prompts: array(PromptSchema)
    });
    GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * The name of the prompt or prompt template.
       */
      name: string2(),
      /**
       * Arguments to use for templating the prompt.
       */
      arguments: record(string2(), string2()).optional()
    });
    GetPromptRequestSchema = RequestSchema.extend({
      method: literal("prompts/get"),
      params: GetPromptRequestParamsSchema
    });
    TextContentSchema = object2({
      type: literal("text"),
      /**
       * The text content of the message.
       */
      text: string2(),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    ImageContentSchema = object2({
      type: literal("image"),
      /**
       * The base64-encoded image data.
       */
      data: Base64Schema,
      /**
       * The MIME type of the image. Different providers may support different image types.
       */
      mimeType: string2(),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    AudioContentSchema = object2({
      type: literal("audio"),
      /**
       * The base64-encoded audio data.
       */
      data: Base64Schema,
      /**
       * The MIME type of the audio. Different providers may support different audio types.
       */
      mimeType: string2(),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    ToolUseContentSchema = object2({
      type: literal("tool_use"),
      /**
       * The name of the tool to invoke.
       * Must match a tool name from the request's tools array.
       */
      name: string2(),
      /**
       * Unique identifier for this tool call.
       * Used to correlate with ToolResultContent in subsequent messages.
       */
      id: string2(),
      /**
       * Arguments to pass to the tool.
       * Must conform to the tool's inputSchema.
       */
      input: record(string2(), unknown()),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    EmbeddedResourceSchema = object2({
      type: literal("resource"),
      resource: union([TextResourceContentsSchema, BlobResourceContentsSchema]),
      /**
       * Optional annotations for the client.
       */
      annotations: AnnotationsSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    ResourceLinkSchema = ResourceSchema.extend({
      type: literal("resource_link")
    });
    ContentBlockSchema = union([
      TextContentSchema,
      ImageContentSchema,
      AudioContentSchema,
      ResourceLinkSchema,
      EmbeddedResourceSchema
    ]);
    PromptMessageSchema = object2({
      role: RoleSchema,
      content: ContentBlockSchema
    });
    GetPromptResultSchema = ResultSchema.extend({
      /**
       * An optional description for the prompt.
       */
      description: string2().optional(),
      messages: array(PromptMessageSchema)
    });
    PromptListChangedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/prompts/list_changed"),
      params: NotificationsParamsSchema.optional()
    });
    ToolAnnotationsSchema = object2({
      /**
       * A human-readable title for the tool.
       */
      title: string2().optional(),
      /**
       * If true, the tool does not modify its environment.
       *
       * Default: false
       */
      readOnlyHint: boolean2().optional(),
      /**
       * If true, the tool may perform destructive updates to its environment.
       * If false, the tool performs only additive updates.
       *
       * (This property is meaningful only when `readOnlyHint == false`)
       *
       * Default: true
       */
      destructiveHint: boolean2().optional(),
      /**
       * If true, calling the tool repeatedly with the same arguments
       * will have no additional effect on the its environment.
       *
       * (This property is meaningful only when `readOnlyHint == false`)
       *
       * Default: false
       */
      idempotentHint: boolean2().optional(),
      /**
       * If true, this tool may interact with an "open world" of external
       * entities. If false, the tool's domain of interaction is closed.
       * For example, the world of a web search tool is open, whereas that
       * of a memory tool is not.
       *
       * Default: true
       */
      openWorldHint: boolean2().optional()
    });
    ToolExecutionSchema = object2({
      /**
       * Indicates the tool's preference for task-augmented execution.
       * - "required": Clients MUST invoke the tool as a task
       * - "optional": Clients MAY invoke the tool as a task or normal request
       * - "forbidden": Clients MUST NOT attempt to invoke the tool as a task
       *
       * If not present, defaults to "forbidden".
       */
      taskSupport: _enum(["required", "optional", "forbidden"]).optional()
    });
    ToolSchema = object2({
      ...BaseMetadataSchema.shape,
      ...IconsSchema.shape,
      /**
       * A human-readable description of the tool.
       */
      description: string2().optional(),
      /**
       * A JSON Schema 2020-12 object defining the expected parameters for the tool.
       * Must have type: 'object' at the root level per MCP spec.
       */
      inputSchema: object2({
        type: literal("object"),
        properties: record(string2(), AssertObjectSchema).optional(),
        required: array(string2()).optional()
      }).catchall(unknown()),
      /**
       * An optional JSON Schema 2020-12 object defining the structure of the tool's output
       * returned in the structuredContent field of a CallToolResult.
       * Must have type: 'object' at the root level per MCP spec.
       */
      outputSchema: object2({
        type: literal("object"),
        properties: record(string2(), AssertObjectSchema).optional(),
        required: array(string2()).optional()
      }).catchall(unknown()).optional(),
      /**
       * Optional additional tool information.
       */
      annotations: ToolAnnotationsSchema.optional(),
      /**
       * Execution-related properties for this tool.
       */
      execution: ToolExecutionSchema.optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    ListToolsRequestSchema = PaginatedRequestSchema.extend({
      method: literal("tools/list")
    });
    ListToolsResultSchema = PaginatedResultSchema.extend({
      tools: array(ToolSchema)
    });
    CallToolResultSchema = ResultSchema.extend({
      /**
       * A list of content objects that represent the result of the tool call.
       *
       * If the Tool does not define an outputSchema, this field MUST be present in the result.
       * For backwards compatibility, this field is always present, but it may be empty.
       */
      content: array(ContentBlockSchema).default([]),
      /**
       * An object containing structured tool output.
       *
       * If the Tool defines an outputSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
       */
      structuredContent: record(string2(), unknown()).optional(),
      /**
       * Whether the tool call ended in an error.
       *
       * If not set, this is assumed to be false (the call was successful).
       *
       * Any errors that originate from the tool SHOULD be reported inside the result
       * object, with `isError` set to true, _not_ as an MCP protocol-level error
       * response. Otherwise, the LLM would not be able to see that an error occurred
       * and self-correct.
       *
       * However, any errors in _finding_ the tool, an error indicating that the
       * server does not support tool calls, or any other exceptional conditions,
       * should be reported as an MCP error response.
       */
      isError: boolean2().optional()
    });
    CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
      toolResult: unknown()
    }));
    CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
      /**
       * The name of the tool to call.
       */
      name: string2(),
      /**
       * Arguments to pass to the tool.
       */
      arguments: record(string2(), unknown()).optional()
    });
    CallToolRequestSchema = RequestSchema.extend({
      method: literal("tools/call"),
      params: CallToolRequestParamsSchema
    });
    ToolListChangedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/tools/list_changed"),
      params: NotificationsParamsSchema.optional()
    });
    ListChangedOptionsBaseSchema = object2({
      /**
       * If true, the list will be refreshed automatically when a list changed notification is received.
       * The callback will be called with the updated list.
       *
       * If false, the callback will be called with null items, allowing manual refresh.
       *
       * @default true
       */
      autoRefresh: boolean2().default(true),
      /**
       * Debounce time in milliseconds for list changed notification processing.
       *
       * Multiple notifications received within this timeframe will only trigger one refresh.
       * Set to 0 to disable debouncing.
       *
       * @default 300
       */
      debounceMs: number2().int().nonnegative().default(300)
    });
    LoggingLevelSchema = _enum(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]);
    SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
      /**
       * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
       */
      level: LoggingLevelSchema
    });
    SetLevelRequestSchema = RequestSchema.extend({
      method: literal("logging/setLevel"),
      params: SetLevelRequestParamsSchema
    });
    LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
      /**
       * The severity of this log message.
       */
      level: LoggingLevelSchema,
      /**
       * An optional name of the logger issuing this message.
       */
      logger: string2().optional(),
      /**
       * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
       */
      data: unknown()
    });
    LoggingMessageNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/message"),
      params: LoggingMessageNotificationParamsSchema
    });
    ModelHintSchema = object2({
      /**
       * A hint for a model name.
       */
      name: string2().optional()
    });
    ModelPreferencesSchema = object2({
      /**
       * Optional hints to use for model selection.
       */
      hints: array(ModelHintSchema).optional(),
      /**
       * How much to prioritize cost when selecting a model.
       */
      costPriority: number2().min(0).max(1).optional(),
      /**
       * How much to prioritize sampling speed (latency) when selecting a model.
       */
      speedPriority: number2().min(0).max(1).optional(),
      /**
       * How much to prioritize intelligence and capabilities when selecting a model.
       */
      intelligencePriority: number2().min(0).max(1).optional()
    });
    ToolChoiceSchema = object2({
      /**
       * Controls when tools are used:
       * - "auto": Model decides whether to use tools (default)
       * - "required": Model MUST use at least one tool before completing
       * - "none": Model MUST NOT use any tools
       */
      mode: _enum(["auto", "required", "none"]).optional()
    });
    ToolResultContentSchema = object2({
      type: literal("tool_result"),
      toolUseId: string2().describe("The unique identifier for the corresponding tool call."),
      content: array(ContentBlockSchema).default([]),
      structuredContent: object2({}).loose().optional(),
      isError: boolean2().optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    SamplingContentSchema = discriminatedUnion("type", [TextContentSchema, ImageContentSchema, AudioContentSchema]);
    SamplingMessageContentBlockSchema = discriminatedUnion("type", [
      TextContentSchema,
      ImageContentSchema,
      AudioContentSchema,
      ToolUseContentSchema,
      ToolResultContentSchema
    ]);
    SamplingMessageSchema = object2({
      role: RoleSchema,
      content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)]),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
      messages: array(SamplingMessageSchema),
      /**
       * The server's preferences for which model to select. The client MAY modify or omit this request.
       */
      modelPreferences: ModelPreferencesSchema.optional(),
      /**
       * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
       */
      systemPrompt: string2().optional(),
      /**
       * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.
       * The client MAY ignore this request.
       *
       * Default is "none". Values "thisServer" and "allServers" are soft-deprecated. Servers SHOULD only use these values if the client
       * declares ClientCapabilities.sampling.context. These values may be removed in future spec releases.
       */
      includeContext: _enum(["none", "thisServer", "allServers"]).optional(),
      temperature: number2().optional(),
      /**
       * The requested maximum number of tokens to sample (to prevent runaway completions).
       *
       * The client MAY choose to sample fewer tokens than the requested maximum.
       */
      maxTokens: number2().int(),
      stopSequences: array(string2()).optional(),
      /**
       * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
       */
      metadata: AssertObjectSchema.optional(),
      /**
       * Tools that the model may use during generation.
       * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
       */
      tools: array(ToolSchema).optional(),
      /**
       * Controls how the model uses tools.
       * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
       * Default is `{ mode: "auto" }`.
       */
      toolChoice: ToolChoiceSchema.optional()
    });
    CreateMessageRequestSchema = RequestSchema.extend({
      method: literal("sampling/createMessage"),
      params: CreateMessageRequestParamsSchema
    });
    CreateMessageResultSchema = ResultSchema.extend({
      /**
       * The name of the model that generated the message.
       */
      model: string2(),
      /**
       * The reason why sampling stopped, if known.
       *
       * Standard values:
       * - "endTurn": Natural end of the assistant's turn
       * - "stopSequence": A stop sequence was encountered
       * - "maxTokens": Maximum token limit was reached
       *
       * This field is an open string to allow for provider-specific stop reasons.
       */
      stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens"]).or(string2())),
      role: RoleSchema,
      /**
       * Response content. Single content block (text, image, or audio).
       */
      content: SamplingContentSchema
    });
    CreateMessageResultWithToolsSchema = ResultSchema.extend({
      /**
       * The name of the model that generated the message.
       */
      model: string2(),
      /**
       * The reason why sampling stopped, if known.
       *
       * Standard values:
       * - "endTurn": Natural end of the assistant's turn
       * - "stopSequence": A stop sequence was encountered
       * - "maxTokens": Maximum token limit was reached
       * - "toolUse": The model wants to use one or more tools
       *
       * This field is an open string to allow for provider-specific stop reasons.
       */
      stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(string2())),
      role: RoleSchema,
      /**
       * Response content. May be a single block or array. May include ToolUseContent if stopReason is "toolUse".
       */
      content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)])
    });
    BooleanSchemaSchema = object2({
      type: literal("boolean"),
      title: string2().optional(),
      description: string2().optional(),
      default: boolean2().optional()
    });
    StringSchemaSchema = object2({
      type: literal("string"),
      title: string2().optional(),
      description: string2().optional(),
      minLength: number2().optional(),
      maxLength: number2().optional(),
      format: _enum(["email", "uri", "date", "date-time"]).optional(),
      default: string2().optional()
    });
    NumberSchemaSchema = object2({
      type: _enum(["number", "integer"]),
      title: string2().optional(),
      description: string2().optional(),
      minimum: number2().optional(),
      maximum: number2().optional(),
      default: number2().optional()
    });
    UntitledSingleSelectEnumSchemaSchema = object2({
      type: literal("string"),
      title: string2().optional(),
      description: string2().optional(),
      enum: array(string2()),
      default: string2().optional()
    });
    TitledSingleSelectEnumSchemaSchema = object2({
      type: literal("string"),
      title: string2().optional(),
      description: string2().optional(),
      oneOf: array(object2({
        const: string2(),
        title: string2()
      })),
      default: string2().optional()
    });
    LegacyTitledEnumSchemaSchema = object2({
      type: literal("string"),
      title: string2().optional(),
      description: string2().optional(),
      enum: array(string2()),
      enumNames: array(string2()).optional(),
      default: string2().optional()
    });
    SingleSelectEnumSchemaSchema = union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
    UntitledMultiSelectEnumSchemaSchema = object2({
      type: literal("array"),
      title: string2().optional(),
      description: string2().optional(),
      minItems: number2().optional(),
      maxItems: number2().optional(),
      items: object2({
        type: literal("string"),
        enum: array(string2())
      }),
      default: array(string2()).optional()
    });
    TitledMultiSelectEnumSchemaSchema = object2({
      type: literal("array"),
      title: string2().optional(),
      description: string2().optional(),
      minItems: number2().optional(),
      maxItems: number2().optional(),
      items: object2({
        anyOf: array(object2({
          const: string2(),
          title: string2()
        }))
      }),
      default: array(string2()).optional()
    });
    MultiSelectEnumSchemaSchema = union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
    EnumSchemaSchema = union([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]);
    PrimitiveSchemaDefinitionSchema = union([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]);
    ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
      /**
       * The elicitation mode.
       *
       * Optional for backward compatibility. Clients MUST treat missing mode as "form".
       */
      mode: literal("form").optional(),
      /**
       * The message to present to the user describing what information is being requested.
       */
      message: string2(),
      /**
       * A restricted subset of JSON Schema.
       * Only top-level properties are allowed, without nesting.
       */
      requestedSchema: object2({
        type: literal("object"),
        properties: record(string2(), PrimitiveSchemaDefinitionSchema),
        required: array(string2()).optional()
      })
    });
    ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
      /**
       * The elicitation mode.
       */
      mode: literal("url"),
      /**
       * The message to present to the user explaining why the interaction is needed.
       */
      message: string2(),
      /**
       * The ID of the elicitation, which must be unique within the context of the server.
       * The client MUST treat this ID as an opaque value.
       */
      elicitationId: string2(),
      /**
       * The URL that the user should navigate to.
       */
      url: string2().url()
    });
    ElicitRequestParamsSchema = union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
    ElicitRequestSchema = RequestSchema.extend({
      method: literal("elicitation/create"),
      params: ElicitRequestParamsSchema
    });
    ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
      /**
       * The ID of the elicitation that completed.
       */
      elicitationId: string2()
    });
    ElicitationCompleteNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/elicitation/complete"),
      params: ElicitationCompleteNotificationParamsSchema
    });
    ElicitResultSchema = ResultSchema.extend({
      /**
       * The user action in response to the elicitation.
       * - "accept": User submitted the form/confirmed the action
       * - "decline": User explicitly decline the action
       * - "cancel": User dismissed without making an explicit choice
       */
      action: _enum(["accept", "decline", "cancel"]),
      /**
       * The submitted form data, only present when action is "accept".
       * Contains values matching the requested schema.
       * Per MCP spec, content is "typically omitted" for decline/cancel actions.
       * We normalize null to undefined for leniency while maintaining type compatibility.
       */
      content: preprocess((val) => val === null ? void 0 : val, record(string2(), union([string2(), number2(), boolean2(), array(string2())])).optional())
    });
    ResourceTemplateReferenceSchema = object2({
      type: literal("ref/resource"),
      /**
       * The URI or URI template of the resource.
       */
      uri: string2()
    });
    PromptReferenceSchema = object2({
      type: literal("ref/prompt"),
      /**
       * The name of the prompt or prompt template
       */
      name: string2()
    });
    CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
      ref: union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
      /**
       * The argument's information
       */
      argument: object2({
        /**
         * The name of the argument
         */
        name: string2(),
        /**
         * The value of the argument to use for completion matching.
         */
        value: string2()
      }),
      context: object2({
        /**
         * Previously-resolved variables in a URI template or prompt.
         */
        arguments: record(string2(), string2()).optional()
      }).optional()
    });
    CompleteRequestSchema = RequestSchema.extend({
      method: literal("completion/complete"),
      params: CompleteRequestParamsSchema
    });
    CompleteResultSchema = ResultSchema.extend({
      completion: looseObject({
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: array(string2()).max(100),
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: optional(number2().int()),
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: optional(boolean2())
      })
    });
    RootSchema = object2({
      /**
       * The URI identifying the root. This *must* start with file:// for now.
       */
      uri: string2().startsWith("file://"),
      /**
       * An optional name for the root.
       */
      name: string2().optional(),
      /**
       * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
       * for notes on _meta usage.
       */
      _meta: record(string2(), unknown()).optional()
    });
    ListRootsRequestSchema = RequestSchema.extend({
      method: literal("roots/list"),
      params: BaseRequestParamsSchema.optional()
    });
    ListRootsResultSchema = ResultSchema.extend({
      roots: array(RootSchema)
    });
    RootsListChangedNotificationSchema = NotificationSchema.extend({
      method: literal("notifications/roots/list_changed"),
      params: NotificationsParamsSchema.optional()
    });
    ClientRequestSchema = union([
      PingRequestSchema,
      InitializeRequestSchema,
      CompleteRequestSchema,
      SetLevelRequestSchema,
      GetPromptRequestSchema,
      ListPromptsRequestSchema,
      ListResourcesRequestSchema,
      ListResourceTemplatesRequestSchema,
      ReadResourceRequestSchema,
      SubscribeRequestSchema,
      UnsubscribeRequestSchema,
      CallToolRequestSchema,
      ListToolsRequestSchema,
      GetTaskRequestSchema,
      GetTaskPayloadRequestSchema,
      ListTasksRequestSchema,
      CancelTaskRequestSchema
    ]);
    ClientNotificationSchema = union([
      CancelledNotificationSchema,
      ProgressNotificationSchema,
      InitializedNotificationSchema,
      RootsListChangedNotificationSchema,
      TaskStatusNotificationSchema
    ]);
    ClientResultSchema = union([
      EmptyResultSchema,
      CreateMessageResultSchema,
      CreateMessageResultWithToolsSchema,
      ElicitResultSchema,
      ListRootsResultSchema,
      GetTaskResultSchema,
      ListTasksResultSchema,
      CreateTaskResultSchema
    ]);
    ServerRequestSchema = union([
      PingRequestSchema,
      CreateMessageRequestSchema,
      ElicitRequestSchema,
      ListRootsRequestSchema,
      GetTaskRequestSchema,
      GetTaskPayloadRequestSchema,
      ListTasksRequestSchema,
      CancelTaskRequestSchema
    ]);
    ServerNotificationSchema = union([
      CancelledNotificationSchema,
      ProgressNotificationSchema,
      LoggingMessageNotificationSchema,
      ResourceUpdatedNotificationSchema,
      ResourceListChangedNotificationSchema,
      ToolListChangedNotificationSchema,
      PromptListChangedNotificationSchema,
      TaskStatusNotificationSchema,
      ElicitationCompleteNotificationSchema
    ]);
    ServerResultSchema = union([
      EmptyResultSchema,
      InitializeResultSchema,
      CompleteResultSchema,
      GetPromptResultSchema,
      ListPromptsResultSchema,
      ListResourcesResultSchema,
      ListResourceTemplatesResultSchema,
      ReadResourceResultSchema,
      CallToolResultSchema,
      ListToolsResultSchema,
      GetTaskResultSchema,
      ListTasksResultSchema,
      CreateTaskResultSchema
    ]);
    McpError = class _McpError extends Error {
      constructor(code, message, data) {
        super(`MCP error ${code}: ${message}`);
        this.code = code;
        this.data = data;
        this.name = "McpError";
      }
      /**
       * Factory method to create the appropriate error type based on the error code and data
       */
      static fromError(code, message, data) {
        if (code === ErrorCode.UrlElicitationRequired && data) {
          const errorData = data;
          if (errorData.elicitations) {
            return new UrlElicitationRequiredError(errorData.elicitations, message);
          }
        }
        return new _McpError(code, message, data);
      }
    };
    UrlElicitationRequiredError = class extends McpError {
      constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
        super(ErrorCode.UrlElicitationRequired, message, {
          elicitations
        });
      }
      get elicitations() {
        return this.data?.elicitations ?? [];
      }
    };
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function isTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
var init_interfaces = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/Options.js
var init_Options = __esm({
  "node_modules/zod-to-json-schema/dist/esm/Options.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/Refs.js
var init_Refs = __esm({
  "node_modules/zod-to-json-schema/dist/esm/Refs.js"() {
    init_Options();
  }
});

// node_modules/zod-to-json-schema/dist/esm/errorMessages.js
var init_errorMessages = __esm({
  "node_modules/zod-to-json-schema/dist/esm/errorMessages.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var init_getRelativePath = __esm({
  "node_modules/zod-to-json-schema/dist/esm/getRelativePath.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/any.js
var init_any = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/any.js"() {
    init_getRelativePath();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/array.js
var init_array = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/array.js"() {
    init_errorMessages();
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
var init_bigint = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js"() {
    init_errorMessages();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
var init_boolean = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
var init_branded = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/branded.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var init_catch = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/catch.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/date.js
var init_date = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/date.js"() {
    init_errorMessages();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/default.js
var init_default = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/default.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
var init_effects = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/effects.js"() {
    init_parseDef();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
var init_enum = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/enum.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var init_intersection = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
var init_literal = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/literal.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var ALPHA_NUMERIC;
var init_string = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/string.js"() {
    init_errorMessages();
    ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/record.js
var init_record = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/record.js"() {
    init_parseDef();
    init_string();
    init_branded();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/map.js
var init_map = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/map.js"() {
    init_parseDef();
    init_record();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
var init_nativeEnum = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/never.js
var init_never = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/never.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/null.js
var init_null = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/null.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var init_union = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/union.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
var init_nullable = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js"() {
    init_parseDef();
    init_union();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/number.js
var init_number = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/number.js"() {
    init_errorMessages();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/object.js
var init_object = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/object.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var init_optional = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/optional.js"() {
    init_parseDef();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js
var init_pipeline = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
var init_promise = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/promise.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/set.js
var init_set = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/set.js"() {
    init_errorMessages();
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
var init_tuple = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
var init_undefined = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
var init_unknown = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var init_readonly = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/selectParser.js
var init_selectParser = __esm({
  "node_modules/zod-to-json-schema/dist/esm/selectParser.js"() {
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_branded();
    init_catch();
    init_date();
    init_default();
    init_effects();
    init_enum();
    init_intersection();
    init_literal();
    init_map();
    init_nativeEnum();
    init_never();
    init_null();
    init_nullable();
    init_number();
    init_object();
    init_optional();
    init_pipeline();
    init_promise();
    init_record();
    init_set();
    init_string();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_readonly();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parseDef.js
var init_parseDef = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parseDef.js"() {
    init_Options();
    init_selectParser();
    init_getRelativePath();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parseTypes.js
var init_parseTypes = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parseTypes.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js
var init_zodToJsonSchema = __esm({
  "node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js"() {
    init_parseDef();
    init_Refs();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/index.js
var init_esm = __esm({
  "node_modules/zod-to-json-schema/dist/esm/index.js"() {
    init_Options();
    init_Refs();
    init_errorMessages();
    init_getRelativePath();
    init_parseDef();
    init_parseTypes();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_branded();
    init_catch();
    init_date();
    init_default();
    init_effects();
    init_enum();
    init_intersection();
    init_literal();
    init_map();
    init_nativeEnum();
    init_never();
    init_null();
    init_nullable();
    init_number();
    init_object();
    init_optional();
    init_pipeline();
    init_promise();
    init_readonly();
    init_record();
    init_set();
    init_string();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_selectParser();
    init_zodToJsonSchema();
    init_zodToJsonSchema();
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
function getMethodLiteral(schema) {
  const shape = getObjectShape(schema);
  const methodSchema = shape?.method;
  if (!methodSchema) {
    throw new Error("Schema is missing a method literal");
  }
  const value = getLiteralValue(methodSchema);
  if (typeof value !== "string") {
    throw new Error("Schema method literal must be a string");
  }
  return value;
}
function parseWithCompat(schema, data) {
  const result = safeParse2(schema, data);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}
var init_zod_json_schema_compat = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js"() {
    init_zod_compat();
    init_esm();
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
  const result = { ...base };
  for (const key in additional) {
    const k = key;
    const addValue = additional[k];
    if (addValue === void 0)
      continue;
    const baseValue = result[k];
    if (isPlainObject2(baseValue) && isPlainObject2(addValue)) {
      result[k] = { ...baseValue, ...addValue };
    } else {
      result[k] = addValue;
    }
  }
  return result;
}
var DEFAULT_REQUEST_TIMEOUT_MSEC, Protocol;
var init_protocol = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js"() {
    init_zod_compat();
    init_types();
    init_interfaces();
    init_zod_json_schema_compat();
    DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4;
    Protocol = class {
      constructor(_options) {
        this._options = _options;
        this._requestMessageId = 0;
        this._requestHandlers = /* @__PURE__ */ new Map();
        this._requestHandlerAbortControllers = /* @__PURE__ */ new Map();
        this._notificationHandlers = /* @__PURE__ */ new Map();
        this._responseHandlers = /* @__PURE__ */ new Map();
        this._progressHandlers = /* @__PURE__ */ new Map();
        this._timeoutInfo = /* @__PURE__ */ new Map();
        this._pendingDebouncedNotifications = /* @__PURE__ */ new Set();
        this._taskProgressTokens = /* @__PURE__ */ new Map();
        this._requestResolvers = /* @__PURE__ */ new Map();
        this.setNotificationHandler(CancelledNotificationSchema, (notification) => {
          this._oncancel(notification);
        });
        this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
          this._onprogress(notification);
        });
        this.setRequestHandler(
          PingRequestSchema,
          // Automatic pong by default.
          (_request) => ({})
        );
        this._taskStore = _options?.taskStore;
        this._taskMessageQueue = _options?.taskMessageQueue;
        if (this._taskStore) {
          this.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
            const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
            if (!task) {
              throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
            }
            return {
              ...task
            };
          });
          this.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
            const handleTaskResult = async () => {
              const taskId = request.params.taskId;
              if (this._taskMessageQueue) {
                let queuedMessage;
                while (queuedMessage = await this._taskMessageQueue.dequeue(taskId, extra.sessionId)) {
                  if (queuedMessage.type === "response" || queuedMessage.type === "error") {
                    const message = queuedMessage.message;
                    const requestId = message.id;
                    const resolver = this._requestResolvers.get(requestId);
                    if (resolver) {
                      this._requestResolvers.delete(requestId);
                      if (queuedMessage.type === "response") {
                        resolver(message);
                      } else {
                        const errorMessage = message;
                        const error2 = new McpError(errorMessage.error.code, errorMessage.error.message, errorMessage.error.data);
                        resolver(error2);
                      }
                    } else {
                      const messageType = queuedMessage.type === "response" ? "Response" : "Error";
                      this._onerror(new Error(`${messageType} handler missing for request ${requestId}`));
                    }
                    continue;
                  }
                  await this._transport?.send(queuedMessage.message, { relatedRequestId: extra.requestId });
                }
              }
              const task = await this._taskStore.getTask(taskId, extra.sessionId);
              if (!task) {
                throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
              }
              if (!isTerminal(task.status)) {
                await this._waitForTaskUpdate(taskId, extra.signal);
                return await handleTaskResult();
              }
              if (isTerminal(task.status)) {
                const result = await this._taskStore.getTaskResult(taskId, extra.sessionId);
                this._clearTaskQueue(taskId);
                return {
                  ...result,
                  _meta: {
                    ...result._meta,
                    [RELATED_TASK_META_KEY]: {
                      taskId
                    }
                  }
                };
              }
              return await handleTaskResult();
            };
            return await handleTaskResult();
          });
          this.setRequestHandler(ListTasksRequestSchema, async (request, extra) => {
            try {
              const { tasks, nextCursor } = await this._taskStore.listTasks(request.params?.cursor, extra.sessionId);
              return {
                tasks,
                nextCursor,
                _meta: {}
              };
            } catch (error2) {
              throw new McpError(ErrorCode.InvalidParams, `Failed to list tasks: ${error2 instanceof Error ? error2.message : String(error2)}`);
            }
          });
          this.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
            try {
              const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
              if (!task) {
                throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
              }
              if (isTerminal(task.status)) {
                throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
              }
              await this._taskStore.updateTaskStatus(request.params.taskId, "cancelled", "Client cancelled task execution.", extra.sessionId);
              this._clearTaskQueue(request.params.taskId);
              const cancelledTask = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
              if (!cancelledTask) {
                throw new McpError(ErrorCode.InvalidParams, `Task not found after cancellation: ${request.params.taskId}`);
              }
              return {
                _meta: {},
                ...cancelledTask
              };
            } catch (error2) {
              if (error2 instanceof McpError) {
                throw error2;
              }
              throw new McpError(ErrorCode.InvalidRequest, `Failed to cancel task: ${error2 instanceof Error ? error2.message : String(error2)}`);
            }
          });
        }
      }
      async _oncancel(notification) {
        if (!notification.params.requestId) {
          return;
        }
        const controller = this._requestHandlerAbortControllers.get(notification.params.requestId);
        controller?.abort(notification.params.reason);
      }
      _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
        this._timeoutInfo.set(messageId, {
          timeoutId: setTimeout(onTimeout, timeout),
          startTime: Date.now(),
          timeout,
          maxTotalTimeout,
          resetTimeoutOnProgress,
          onTimeout
        });
      }
      _resetTimeout(messageId) {
        const info = this._timeoutInfo.get(messageId);
        if (!info)
          return false;
        const totalElapsed = Date.now() - info.startTime;
        if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
          this._timeoutInfo.delete(messageId);
          throw McpError.fromError(ErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
            maxTotalTimeout: info.maxTotalTimeout,
            totalElapsed
          });
        }
        clearTimeout(info.timeoutId);
        info.timeoutId = setTimeout(info.onTimeout, info.timeout);
        return true;
      }
      _cleanupTimeout(messageId) {
        const info = this._timeoutInfo.get(messageId);
        if (info) {
          clearTimeout(info.timeoutId);
          this._timeoutInfo.delete(messageId);
        }
      }
      /**
       * Attaches to the given transport, starts it, and starts listening for messages.
       *
       * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
       */
      async connect(transport) {
        if (this._transport) {
          throw new Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
        }
        this._transport = transport;
        const _onclose = this.transport?.onclose;
        this._transport.onclose = () => {
          _onclose?.();
          this._onclose();
        };
        const _onerror = this.transport?.onerror;
        this._transport.onerror = (error2) => {
          _onerror?.(error2);
          this._onerror(error2);
        };
        const _onmessage = this._transport?.onmessage;
        this._transport.onmessage = (message, extra) => {
          _onmessage?.(message, extra);
          if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
            this._onresponse(message);
          } else if (isJSONRPCRequest(message)) {
            this._onrequest(message, extra);
          } else if (isJSONRPCNotification(message)) {
            this._onnotification(message);
          } else {
            this._onerror(new Error(`Unknown message type: ${JSON.stringify(message)}`));
          }
        };
        await this._transport.start();
      }
      _onclose() {
        const responseHandlers = this._responseHandlers;
        this._responseHandlers = /* @__PURE__ */ new Map();
        this._progressHandlers.clear();
        this._taskProgressTokens.clear();
        this._pendingDebouncedNotifications.clear();
        for (const controller of this._requestHandlerAbortControllers.values()) {
          controller.abort();
        }
        this._requestHandlerAbortControllers.clear();
        const error2 = McpError.fromError(ErrorCode.ConnectionClosed, "Connection closed");
        this._transport = void 0;
        this.onclose?.();
        for (const handler of responseHandlers.values()) {
          handler(error2);
        }
      }
      _onerror(error2) {
        this.onerror?.(error2);
      }
      _onnotification(notification) {
        const handler = this._notificationHandlers.get(notification.method) ?? this.fallbackNotificationHandler;
        if (handler === void 0) {
          return;
        }
        Promise.resolve().then(() => handler(notification)).catch((error2) => this._onerror(new Error(`Uncaught error in notification handler: ${error2}`)));
      }
      _onrequest(request, extra) {
        const handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;
        const capturedTransport = this._transport;
        const relatedTaskId = request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId;
        if (handler === void 0) {
          const errorResponse = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: ErrorCode.MethodNotFound,
              message: "Method not found"
            }
          };
          if (relatedTaskId && this._taskMessageQueue) {
            this._enqueueTaskMessage(relatedTaskId, {
              type: "error",
              message: errorResponse,
              timestamp: Date.now()
            }, capturedTransport?.sessionId).catch((error2) => this._onerror(new Error(`Failed to enqueue error response: ${error2}`)));
          } else {
            capturedTransport?.send(errorResponse).catch((error2) => this._onerror(new Error(`Failed to send an error response: ${error2}`)));
          }
          return;
        }
        const abortController = new AbortController();
        this._requestHandlerAbortControllers.set(request.id, abortController);
        const taskCreationParams = isTaskAugmentedRequestParams(request.params) ? request.params.task : void 0;
        const taskStore = this._taskStore ? this.requestTaskStore(request, capturedTransport?.sessionId) : void 0;
        const fullExtra = {
          signal: abortController.signal,
          sessionId: capturedTransport?.sessionId,
          _meta: request.params?._meta,
          sendNotification: async (notification) => {
            if (abortController.signal.aborted)
              return;
            const notificationOptions = { relatedRequestId: request.id };
            if (relatedTaskId) {
              notificationOptions.relatedTask = { taskId: relatedTaskId };
            }
            await this.notification(notification, notificationOptions);
          },
          sendRequest: async (r, resultSchema, options) => {
            if (abortController.signal.aborted) {
              throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
            }
            const requestOptions = { ...options, relatedRequestId: request.id };
            if (relatedTaskId && !requestOptions.relatedTask) {
              requestOptions.relatedTask = { taskId: relatedTaskId };
            }
            const effectiveTaskId = requestOptions.relatedTask?.taskId ?? relatedTaskId;
            if (effectiveTaskId && taskStore) {
              await taskStore.updateTaskStatus(effectiveTaskId, "input_required");
            }
            return await this.request(r, resultSchema, requestOptions);
          },
          authInfo: extra?.authInfo,
          requestId: request.id,
          requestInfo: extra?.requestInfo,
          taskId: relatedTaskId,
          taskStore,
          taskRequestedTtl: taskCreationParams?.ttl,
          closeSSEStream: extra?.closeSSEStream,
          closeStandaloneSSEStream: extra?.closeStandaloneSSEStream
        };
        Promise.resolve().then(() => {
          if (taskCreationParams) {
            this.assertTaskHandlerCapability(request.method);
          }
        }).then(() => handler(request, fullExtra)).then(async (result) => {
          if (abortController.signal.aborted) {
            return;
          }
          const response = {
            result,
            jsonrpc: "2.0",
            id: request.id
          };
          if (relatedTaskId && this._taskMessageQueue) {
            await this._enqueueTaskMessage(relatedTaskId, {
              type: "response",
              message: response,
              timestamp: Date.now()
            }, capturedTransport?.sessionId);
          } else {
            await capturedTransport?.send(response);
          }
        }, async (error2) => {
          if (abortController.signal.aborted) {
            return;
          }
          const errorResponse = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: Number.isSafeInteger(error2["code"]) ? error2["code"] : ErrorCode.InternalError,
              message: error2.message ?? "Internal error",
              ...error2["data"] !== void 0 && { data: error2["data"] }
            }
          };
          if (relatedTaskId && this._taskMessageQueue) {
            await this._enqueueTaskMessage(relatedTaskId, {
              type: "error",
              message: errorResponse,
              timestamp: Date.now()
            }, capturedTransport?.sessionId);
          } else {
            await capturedTransport?.send(errorResponse);
          }
        }).catch((error2) => this._onerror(new Error(`Failed to send response: ${error2}`))).finally(() => {
          this._requestHandlerAbortControllers.delete(request.id);
        });
      }
      _onprogress(notification) {
        const { progressToken, ...params } = notification.params;
        const messageId = Number(progressToken);
        const handler = this._progressHandlers.get(messageId);
        if (!handler) {
          this._onerror(new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
          return;
        }
        const responseHandler = this._responseHandlers.get(messageId);
        const timeoutInfo = this._timeoutInfo.get(messageId);
        if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) {
          try {
            this._resetTimeout(messageId);
          } catch (error2) {
            this._responseHandlers.delete(messageId);
            this._progressHandlers.delete(messageId);
            this._cleanupTimeout(messageId);
            responseHandler(error2);
            return;
          }
        }
        handler(params);
      }
      _onresponse(response) {
        const messageId = Number(response.id);
        const resolver = this._requestResolvers.get(messageId);
        if (resolver) {
          this._requestResolvers.delete(messageId);
          if (isJSONRPCResultResponse(response)) {
            resolver(response);
          } else {
            const error2 = new McpError(response.error.code, response.error.message, response.error.data);
            resolver(error2);
          }
          return;
        }
        const handler = this._responseHandlers.get(messageId);
        if (handler === void 0) {
          this._onerror(new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
          return;
        }
        this._responseHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        let isTaskResponse = false;
        if (isJSONRPCResultResponse(response) && response.result && typeof response.result === "object") {
          const result = response.result;
          if (result.task && typeof result.task === "object") {
            const task = result.task;
            if (typeof task.taskId === "string") {
              isTaskResponse = true;
              this._taskProgressTokens.set(task.taskId, messageId);
            }
          }
        }
        if (!isTaskResponse) {
          this._progressHandlers.delete(messageId);
        }
        if (isJSONRPCResultResponse(response)) {
          handler(response);
        } else {
          const error2 = McpError.fromError(response.error.code, response.error.message, response.error.data);
          handler(error2);
        }
      }
      get transport() {
        return this._transport;
      }
      /**
       * Closes the connection.
       */
      async close() {
        await this._transport?.close();
      }
      /**
       * Sends a request and returns an AsyncGenerator that yields response messages.
       * The generator is guaranteed to end with either a 'result' or 'error' message.
       *
       * @example
       * ```typescript
       * const stream = protocol.requestStream(request, resultSchema, options);
       * for await (const message of stream) {
       *   switch (message.type) {
       *     case 'taskCreated':
       *       console.log('Task created:', message.task.taskId);
       *       break;
       *     case 'taskStatus':
       *       console.log('Task status:', message.task.status);
       *       break;
       *     case 'result':
       *       console.log('Final result:', message.result);
       *       break;
       *     case 'error':
       *       console.error('Error:', message.error);
       *       break;
       *   }
       * }
       * ```
       *
       * @experimental Use `client.experimental.tasks.requestStream()` to access this method.
       */
      async *requestStream(request, resultSchema, options) {
        const { task } = options ?? {};
        if (!task) {
          try {
            const result = await this.request(request, resultSchema, options);
            yield { type: "result", result };
          } catch (error2) {
            yield {
              type: "error",
              error: error2 instanceof McpError ? error2 : new McpError(ErrorCode.InternalError, String(error2))
            };
          }
          return;
        }
        let taskId;
        try {
          const createResult = await this.request(request, CreateTaskResultSchema, options);
          if (createResult.task) {
            taskId = createResult.task.taskId;
            yield { type: "taskCreated", task: createResult.task };
          } else {
            throw new McpError(ErrorCode.InternalError, "Task creation did not return a task");
          }
          while (true) {
            const task2 = await this.getTask({ taskId }, options);
            yield { type: "taskStatus", task: task2 };
            if (isTerminal(task2.status)) {
              if (task2.status === "completed") {
                const result = await this.getTaskResult({ taskId }, resultSchema, options);
                yield { type: "result", result };
              } else if (task2.status === "failed") {
                yield {
                  type: "error",
                  error: new McpError(ErrorCode.InternalError, `Task ${taskId} failed`)
                };
              } else if (task2.status === "cancelled") {
                yield {
                  type: "error",
                  error: new McpError(ErrorCode.InternalError, `Task ${taskId} was cancelled`)
                };
              }
              return;
            }
            if (task2.status === "input_required") {
              const result = await this.getTaskResult({ taskId }, resultSchema, options);
              yield { type: "result", result };
              return;
            }
            const pollInterval = task2.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1e3;
            await new Promise((resolve3) => setTimeout(resolve3, pollInterval));
            options?.signal?.throwIfAborted();
          }
        } catch (error2) {
          yield {
            type: "error",
            error: error2 instanceof McpError ? error2 : new McpError(ErrorCode.InternalError, String(error2))
          };
        }
      }
      /**
       * Sends a request and waits for a response.
       *
       * Do not use this method to emit notifications! Use notification() instead.
       */
      request(request, resultSchema, options) {
        const { relatedRequestId, resumptionToken, onresumptiontoken, task, relatedTask } = options ?? {};
        return new Promise((resolve3, reject) => {
          const earlyReject = (error2) => {
            reject(error2);
          };
          if (!this._transport) {
            earlyReject(new Error("Not connected"));
            return;
          }
          if (this._options?.enforceStrictCapabilities === true) {
            try {
              this.assertCapabilityForMethod(request.method);
              if (task) {
                this.assertTaskCapability(request.method);
              }
            } catch (e) {
              earlyReject(e);
              return;
            }
          }
          options?.signal?.throwIfAborted();
          const messageId = this._requestMessageId++;
          const jsonrpcRequest = {
            ...request,
            jsonrpc: "2.0",
            id: messageId
          };
          if (options?.onprogress) {
            this._progressHandlers.set(messageId, options.onprogress);
            jsonrpcRequest.params = {
              ...request.params,
              _meta: {
                ...request.params?._meta || {},
                progressToken: messageId
              }
            };
          }
          if (task) {
            jsonrpcRequest.params = {
              ...jsonrpcRequest.params,
              task
            };
          }
          if (relatedTask) {
            jsonrpcRequest.params = {
              ...jsonrpcRequest.params,
              _meta: {
                ...jsonrpcRequest.params?._meta || {},
                [RELATED_TASK_META_KEY]: relatedTask
              }
            };
          }
          const cancel = (reason) => {
            this._responseHandlers.delete(messageId);
            this._progressHandlers.delete(messageId);
            this._cleanupTimeout(messageId);
            this._transport?.send({
              jsonrpc: "2.0",
              method: "notifications/cancelled",
              params: {
                requestId: messageId,
                reason: String(reason)
              }
            }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error3) => this._onerror(new Error(`Failed to send cancellation: ${error3}`)));
            const error2 = reason instanceof McpError ? reason : new McpError(ErrorCode.RequestTimeout, String(reason));
            reject(error2);
          };
          this._responseHandlers.set(messageId, (response) => {
            if (options?.signal?.aborted) {
              return;
            }
            if (response instanceof Error) {
              return reject(response);
            }
            try {
              const parseResult = safeParse2(resultSchema, response.result);
              if (!parseResult.success) {
                reject(parseResult.error);
              } else {
                resolve3(parseResult.data);
              }
            } catch (error2) {
              reject(error2);
            }
          });
          options?.signal?.addEventListener("abort", () => {
            cancel(options?.signal?.reason);
          });
          const timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
          const timeoutHandler = () => cancel(McpError.fromError(ErrorCode.RequestTimeout, "Request timed out", { timeout }));
          this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? false);
          const relatedTaskId = relatedTask?.taskId;
          if (relatedTaskId) {
            const responseResolver = (response) => {
              const handler = this._responseHandlers.get(messageId);
              if (handler) {
                handler(response);
              } else {
                this._onerror(new Error(`Response handler missing for side-channeled request ${messageId}`));
              }
            };
            this._requestResolvers.set(messageId, responseResolver);
            this._enqueueTaskMessage(relatedTaskId, {
              type: "request",
              message: jsonrpcRequest,
              timestamp: Date.now()
            }).catch((error2) => {
              this._cleanupTimeout(messageId);
              reject(error2);
            });
          } else {
            this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error2) => {
              this._cleanupTimeout(messageId);
              reject(error2);
            });
          }
        });
      }
      /**
       * Gets the current status of a task.
       *
       * @experimental Use `client.experimental.tasks.getTask()` to access this method.
       */
      async getTask(params, options) {
        return this.request({ method: "tasks/get", params }, GetTaskResultSchema, options);
      }
      /**
       * Retrieves the result of a completed task.
       *
       * @experimental Use `client.experimental.tasks.getTaskResult()` to access this method.
       */
      async getTaskResult(params, resultSchema, options) {
        return this.request({ method: "tasks/result", params }, resultSchema, options);
      }
      /**
       * Lists tasks, optionally starting from a pagination cursor.
       *
       * @experimental Use `client.experimental.tasks.listTasks()` to access this method.
       */
      async listTasks(params, options) {
        return this.request({ method: "tasks/list", params }, ListTasksResultSchema, options);
      }
      /**
       * Cancels a specific task.
       *
       * @experimental Use `client.experimental.tasks.cancelTask()` to access this method.
       */
      async cancelTask(params, options) {
        return this.request({ method: "tasks/cancel", params }, CancelTaskResultSchema, options);
      }
      /**
       * Emits a notification, which is a one-way message that does not expect a response.
       */
      async notification(notification, options) {
        if (!this._transport) {
          throw new Error("Not connected");
        }
        this.assertNotificationCapability(notification.method);
        const relatedTaskId = options?.relatedTask?.taskId;
        if (relatedTaskId) {
          const jsonrpcNotification2 = {
            ...notification,
            jsonrpc: "2.0",
            params: {
              ...notification.params,
              _meta: {
                ...notification.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
          await this._enqueueTaskMessage(relatedTaskId, {
            type: "notification",
            message: jsonrpcNotification2,
            timestamp: Date.now()
          });
          return;
        }
        const debouncedMethods = this._options?.debouncedNotificationMethods ?? [];
        const canDebounce = debouncedMethods.includes(notification.method) && !notification.params && !options?.relatedRequestId && !options?.relatedTask;
        if (canDebounce) {
          if (this._pendingDebouncedNotifications.has(notification.method)) {
            return;
          }
          this._pendingDebouncedNotifications.add(notification.method);
          Promise.resolve().then(() => {
            this._pendingDebouncedNotifications.delete(notification.method);
            if (!this._transport) {
              return;
            }
            let jsonrpcNotification2 = {
              ...notification,
              jsonrpc: "2.0"
            };
            if (options?.relatedTask) {
              jsonrpcNotification2 = {
                ...jsonrpcNotification2,
                params: {
                  ...jsonrpcNotification2.params,
                  _meta: {
                    ...jsonrpcNotification2.params?._meta || {},
                    [RELATED_TASK_META_KEY]: options.relatedTask
                  }
                }
              };
            }
            this._transport?.send(jsonrpcNotification2, options).catch((error2) => this._onerror(error2));
          });
          return;
        }
        let jsonrpcNotification = {
          ...notification,
          jsonrpc: "2.0"
        };
        if (options?.relatedTask) {
          jsonrpcNotification = {
            ...jsonrpcNotification,
            params: {
              ...jsonrpcNotification.params,
              _meta: {
                ...jsonrpcNotification.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
        }
        await this._transport.send(jsonrpcNotification, options);
      }
      /**
       * Registers a handler to invoke when this protocol object receives a request with the given method.
       *
       * Note that this will replace any previous request handler for the same method.
       */
      setRequestHandler(requestSchema, handler) {
        const method = getMethodLiteral(requestSchema);
        this.assertRequestHandlerCapability(method);
        this._requestHandlers.set(method, (request, extra) => {
          const parsed = parseWithCompat(requestSchema, request);
          return Promise.resolve(handler(parsed, extra));
        });
      }
      /**
       * Removes the request handler for the given method.
       */
      removeRequestHandler(method) {
        this._requestHandlers.delete(method);
      }
      /**
       * Asserts that a request handler has not already been set for the given method, in preparation for a new one being automatically installed.
       */
      assertCanSetRequestHandler(method) {
        if (this._requestHandlers.has(method)) {
          throw new Error(`A request handler for ${method} already exists, which would be overridden`);
        }
      }
      /**
       * Registers a handler to invoke when this protocol object receives a notification with the given method.
       *
       * Note that this will replace any previous notification handler for the same method.
       */
      setNotificationHandler(notificationSchema, handler) {
        const method = getMethodLiteral(notificationSchema);
        this._notificationHandlers.set(method, (notification) => {
          const parsed = parseWithCompat(notificationSchema, notification);
          return Promise.resolve(handler(parsed));
        });
      }
      /**
       * Removes the notification handler for the given method.
       */
      removeNotificationHandler(method) {
        this._notificationHandlers.delete(method);
      }
      /**
       * Cleans up the progress handler associated with a task.
       * This should be called when a task reaches a terminal status.
       */
      _cleanupTaskProgressHandler(taskId) {
        const progressToken = this._taskProgressTokens.get(taskId);
        if (progressToken !== void 0) {
          this._progressHandlers.delete(progressToken);
          this._taskProgressTokens.delete(taskId);
        }
      }
      /**
       * Enqueues a task-related message for side-channel delivery via tasks/result.
       * @param taskId The task ID to associate the message with
       * @param message The message to enqueue
       * @param sessionId Optional session ID for binding the operation to a specific session
       * @throws Error if taskStore is not configured or if enqueue fails (e.g., queue overflow)
       *
       * Note: If enqueue fails, it's the TaskMessageQueue implementation's responsibility to handle
       * the error appropriately (e.g., by failing the task, logging, etc.). The Protocol layer
       * simply propagates the error.
       */
      async _enqueueTaskMessage(taskId, message, sessionId) {
        if (!this._taskStore || !this._taskMessageQueue) {
          throw new Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
        }
        const maxQueueSize = this._options?.maxTaskQueueSize;
        await this._taskMessageQueue.enqueue(taskId, message, sessionId, maxQueueSize);
      }
      /**
       * Clears the message queue for a task and rejects any pending request resolvers.
       * @param taskId The task ID whose queue should be cleared
       * @param sessionId Optional session ID for binding the operation to a specific session
       */
      async _clearTaskQueue(taskId, sessionId) {
        if (this._taskMessageQueue) {
          const messages = await this._taskMessageQueue.dequeueAll(taskId, sessionId);
          for (const message of messages) {
            if (message.type === "request" && isJSONRPCRequest(message.message)) {
              const requestId = message.message.id;
              const resolver = this._requestResolvers.get(requestId);
              if (resolver) {
                resolver(new McpError(ErrorCode.InternalError, "Task cancelled or completed"));
                this._requestResolvers.delete(requestId);
              } else {
                this._onerror(new Error(`Resolver missing for request ${requestId} during task ${taskId} cleanup`));
              }
            }
          }
        }
      }
      /**
       * Waits for a task update (new messages or status change) with abort signal support.
       * Uses polling to check for updates at the task's configured poll interval.
       * @param taskId The task ID to wait for
       * @param signal Abort signal to cancel the wait
       * @returns Promise that resolves when an update occurs or rejects if aborted
       */
      async _waitForTaskUpdate(taskId, signal) {
        let interval = this._options?.defaultTaskPollInterval ?? 1e3;
        try {
          const task = await this._taskStore?.getTask(taskId);
          if (task?.pollInterval) {
            interval = task.pollInterval;
          }
        } catch {
        }
        return new Promise((resolve3, reject) => {
          if (signal.aborted) {
            reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
            return;
          }
          const timeoutId = setTimeout(resolve3, interval);
          signal.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
          }, { once: true });
        });
      }
      requestTaskStore(request, sessionId) {
        const taskStore = this._taskStore;
        if (!taskStore) {
          throw new Error("No task store configured");
        }
        return {
          createTask: async (taskParams) => {
            if (!request) {
              throw new Error("No request provided");
            }
            return await taskStore.createTask(taskParams, request.id, {
              method: request.method,
              params: request.params
            }, sessionId);
          },
          getTask: async (taskId) => {
            const task = await taskStore.getTask(taskId, sessionId);
            if (!task) {
              throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
            }
            return task;
          },
          storeTaskResult: async (taskId, status, result) => {
            await taskStore.storeTaskResult(taskId, status, result, sessionId);
            const task = await taskStore.getTask(taskId, sessionId);
            if (task) {
              const notification = TaskStatusNotificationSchema.parse({
                method: "notifications/tasks/status",
                params: task
              });
              await this.notification(notification);
              if (isTerminal(task.status)) {
                this._cleanupTaskProgressHandler(taskId);
              }
            }
          },
          getTaskResult: (taskId) => {
            return taskStore.getTaskResult(taskId, sessionId);
          },
          updateTaskStatus: async (taskId, status, statusMessage) => {
            const task = await taskStore.getTask(taskId, sessionId);
            if (!task) {
              throw new McpError(ErrorCode.InvalidParams, `Task "${taskId}" not found - it may have been cleaned up`);
            }
            if (isTerminal(task.status)) {
              throw new McpError(ErrorCode.InvalidParams, `Cannot update task "${taskId}" from terminal status "${task.status}" to "${status}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
            }
            await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
            const updatedTask = await taskStore.getTask(taskId, sessionId);
            if (updatedTask) {
              const notification = TaskStatusNotificationSchema.parse({
                method: "notifications/tasks/status",
                params: updatedTask
              });
              await this.notification(notification);
              if (isTerminal(updatedTask.status)) {
                this._cleanupTaskProgressHandler(taskId);
              }
            }
          },
          listTasks: (cursor) => {
            return taskStore.listTasks(cursor, sessionId);
          }
        };
      }
    };
  }
});

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/ajv/dist/compile/codegen/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports._CodeOrName = _CodeOrName;
    exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports._Code = _Code;
    exports.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports.regexpCode = regexpCode;
  }
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/ajv/dist/compile/codegen/scope.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
    exports.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value) {
        var _a;
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value.ref;
        name.setValue(value, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports.ValueScope = ValueScope;
  }
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/ajv/dist/compile/codegen/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
      constructor(error2) {
        super();
        this.error = error2;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants) {
        this.code = optimizeExpr(this.code, names, constants);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        if (!(super.optimizeNames(names, constants) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants) {
        var _a, _b;
        super.optimizeNames(names, constants);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error2) {
        super();
        this.error = error2;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error2 = this.name("e");
          this._currNode = node.catch = new Catch(error2);
          catchCode(error2);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error2) {
        return this._leafNode(new Throw(error2));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports.not = not;
    var andCode = mappend(exports.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports.and = and;
    var orCode = mappend(exports.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/ajv/dist/compile/util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues: mergeValues2, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues2(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports.checkStrictMode = checkStrictMode;
  }
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/ajv/dist/compile/names.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports.default = names;
  }
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/ajv/dist/compile/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error2 = exports.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error2, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports.reportError = reportError;
    function reportExtraError(cxt, error2 = exports.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error2, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error2, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error2, errorPaths);
    }
    function errorObject(cxt, error2, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error2, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/ajv/dist/compile/validate/boolSchema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/ajv/dist/compile/rules.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRules = exports.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports.getRules = getRules;
  }
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/ajv/dist/compile/validate/applicability.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports.shouldUseRule = shouldUseRule;
  }
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/ajv/dist/compile/validate/dataType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/ajv/dist/compile/validate/defaults.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports.validateUnion = validateUnion;
  }
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/ajv/dist/compile/validate/keyword.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def.errors === false) {
          assignValid();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def.async ? validateAsync() : validateSync();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def) {
      if (def.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result) {
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def.validateSchema) {
        const valid = def.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
          if (opts.validateSchema === "log")
            self.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/ajv/dist/compile/validate/subschema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/json-schema-traverse/index.js"(exports, module) {
    "use strict";
    var traverse = module.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/ajv/dist/compile/resolve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize2) {
      if (normalize2 !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/ajv/dist/compile/validate/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self } = it;
      const { RULES } = self;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts) {
      if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts, t) {
      return ts.includes(t) || t === "integer" && ts.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts.push("integer");
      }
      it.dataTypes = ts;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
          }
        }
        if ("code" in def ? def.trackErrors : def.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def, ruleType) {
      const cxt = new KeywordCxt(it, def, keyword);
      if ("code" in def) {
        def.code(cxt, ruleType);
      } else if (cxt.$data && def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      } else if ("macro" in def) {
        (0, keyword_1.macroKeywordCode)(cxt, def);
      } else if (def.compile || def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports.getData = getData;
  }
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/ajv/dist/runtime/validation_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports.default = ValidationError;
  }
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/ajv/dist/compile/ref_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports.default = MissingRefError;
  }
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/ajv/dist/compile/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
          validate.$async = true;
        if (this.opts.code.source === true) {
          validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate.source)
            validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve3.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve3(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/ajv/dist/refs/data.json"(exports, module) {
    module.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/fast-uri/lib/utils.js"(exports, module) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function consumeIsZone(buffer) {
      buffer.length = 0;
      return true;
    }
    function consumeHextets(buffer, address, output) {
      if (buffer.length) {
        const hex = stringArrayToHexStripped(buffer);
        if (hex !== "") {
          address.push(hex);
        } else {
          output.error = true;
          return false;
        }
        buffer.length = 0;
      }
      return true;
    }
    function getIPV6(input) {
      let tokenCount = 0;
      const output = { error: false, address: "", zone: "" };
      const address = [];
      const buffer = [];
      let endipv6Encountered = false;
      let endIpv6 = false;
      let consume = consumeHextets;
      for (let i = 0; i < input.length; i++) {
        const cursor = input[i];
        if (cursor === "[" || cursor === "]") {
          continue;
        }
        if (cursor === ":") {
          if (endipv6Encountered === true) {
            endIpv6 = true;
          }
          if (!consume(buffer, address, output)) {
            break;
          }
          if (++tokenCount > 7) {
            output.error = true;
            break;
          }
          if (i > 0 && input[i - 1] === ":") {
            endipv6Encountered = true;
          }
          address.push(":");
          continue;
        } else if (cursor === "%") {
          if (!consume(buffer, address, output)) {
            break;
          }
          consume = consumeIsZone;
        } else {
          buffer.push(cursor);
          continue;
        }
      }
      if (buffer.length) {
        if (consume === consumeIsZone) {
          output.zone = buffer.join("");
        } else if (endIpv6) {
          address.push(buffer.join(""));
        } else {
          address.push(stringArrayToHexStripped(buffer));
        }
      }
      output.address = address.join("");
      return output;
    }
    function normalizeIPv6(host) {
      if (findToken(host, ":") < 2) {
        return { host, isIPV6: false };
      }
      const ipv62 = getIPV6(host);
      if (!ipv62.error) {
        let newHost = ipv62.address;
        let escapedHost = ipv62.address;
        if (ipv62.zone) {
          newHost += "%" + ipv62.zone;
          escapedHost += "%25" + ipv62.zone;
        }
        return { host: newHost, isIPV6: true, escapedHost };
      } else {
        return { host, isIPV6: false };
      }
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path6) {
      let input = path6;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    function normalizeComponentEncoding(component, esc2) {
      const func = esc2 !== true ? escape : unescape;
      if (component.scheme !== void 0) {
        component.scheme = func(component.scheme);
      }
      if (component.userinfo !== void 0) {
        component.userinfo = func(component.userinfo);
      }
      if (component.host !== void 0) {
        component.host = func(component.host);
      }
      if (component.path !== void 0) {
        component.path = func(component.path);
      }
      if (component.query !== void 0) {
        component.query = func(component.query);
      }
      if (component.fragment !== void 0) {
        component.fragment = func(component.fragment);
      }
      return component;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(component.userinfo);
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = unescape(component.host);
        if (!isIPv4(host)) {
          const ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = component.host;
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        uriTokens.push(":");
        uriTokens.push(String(component.port));
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      normalizeComponentEncoding,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/fast-uri/lib/schemes.js"(exports, module) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const [path6, query] = wsComponent.resourceName.split("?");
        wsComponent.path = path6 && path6 !== "/" ? path6 : void 0;
        wsComponent.query = query;
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/fast-uri/index.js"(exports, module) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizeComponentEncoding, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    function normalize2(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        serialize(parse4(uri, options), options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse4(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve3(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const resolved = resolveComponent(parse4(baseURI, schemelessOptions), parse4(relativeURI, schemelessOptions), schemelessOptions, true);
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative3, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse4(serialize(base, options), options);
        relative3 = parse4(serialize(relative3, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative3.scheme) {
        target.scheme = relative3.scheme;
        target.userinfo = relative3.userinfo;
        target.host = relative3.host;
        target.port = relative3.port;
        target.path = removeDotSegments(relative3.path || "");
        target.query = relative3.query;
      } else {
        if (relative3.userinfo !== void 0 || relative3.host !== void 0 || relative3.port !== void 0) {
          target.userinfo = relative3.userinfo;
          target.host = relative3.host;
          target.port = relative3.port;
          target.path = removeDotSegments(relative3.path || "");
          target.query = relative3.query;
        } else {
          if (!relative3.path) {
            target.path = base.path;
            if (relative3.query !== void 0) {
              target.query = relative3.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative3.path[0] === "/") {
              target.path = removeDotSegments(relative3.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative3.path;
              } else if (!base.path) {
                target.path = relative3.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative3.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative3.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative3.fragment;
      return target;
    }
    function equal(uriA, uriB, options) {
      if (typeof uriA === "string") {
        uriA = unescape(uriA);
        uriA = serialize(normalizeComponentEncoding(parse4(uriA, options), true), { ...options, skipEscape: true });
      } else if (typeof uriA === "object") {
        uriA = serialize(normalizeComponentEncoding(uriA, true), { ...options, skipEscape: true });
      }
      if (typeof uriB === "string") {
        uriB = unescape(uriB);
        uriB = serialize(normalizeComponentEncoding(parse4(uriB, options), true), { ...options, skipEscape: true });
      } else if (typeof uriB === "object") {
        uriB = serialize(normalizeComponentEncoding(uriB, true), { ...options, skipEscape: true });
      }
      return uriA.toLowerCase() === uriB.toLowerCase();
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = escape(component.path);
          if (component.scheme !== void 0) {
            component.path = component.path.split("%3A").join(":");
          }
        } else {
          component.path = unescape(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", component.query);
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", component.fragment);
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    function parse4(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const ipv6result = normalizeIPv6(parsed.host);
            parsed.host = ipv6result.host.toLowerCase();
            isIP = ipv6result.isIPV6;
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
          if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
            try {
              parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
            } catch (e) {
              parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
            }
          }
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (uri.indexOf("%") !== -1) {
            if (parsed.scheme !== void 0) {
              parsed.scheme = unescape(parsed.scheme);
            }
            if (parsed.host !== void 0) {
              parsed.host = unescape(parsed.host);
            }
          }
          if (parsed.path) {
            parsed.path = escape(unescape(parsed.path));
          }
          if (parsed.fragment) {
            parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return parsed;
    }
    var fastUri = {
      SCHEMES,
      normalize: normalize2,
      resolve: resolve3,
      resolveComponent,
      equal,
      serialize,
      parse: parse4
    };
    module.exports = fastUri;
    module.exports.default = fastUri;
    module.exports.fastUri = fastUri;
  }
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/ajv/dist/runtime/uri.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports.default = uri;
  }
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/ajv/dist/core.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv2 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = {};
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def of definitions)
          this.addKeyword(def);
        return this;
      }
      addKeyword(kwdOrDef, def) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def === void 0) {
          def = kwdOrDef;
          keyword = def.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def);
        if (!def) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def);
        const definition = {
          ...def,
          type: (0, dataType_1.getJSONTypes)(def.type),
          schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv2.ValidationError = validation_error_1.default;
    Ajv2.MissingRefError = ref_error_1.default;
    exports.default = Ajv2;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def = defs[keyword];
        if (!def.keyword)
          def.keyword = keyword;
        this.addKeyword(def);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def)
        return;
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def) {
      let { metaSchema } = def;
      if (metaSchema === void 0)
        return;
      if (def.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/ref.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.callRef = exports.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports.callRef = callRef;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports.default = core;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error2 = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/required.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  }
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/const.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def = {
      keyword: "const",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/enum.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports.default = validation;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error: error2,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports.validateAdditionalItems = validateAdditionalItems;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports.validateTuple = validateTuple;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error2 = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error: error2,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports.validateSchemaDeps = validateSchemaDeps;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error: error2,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error2 = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/not.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/if.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports.default = getApplicator;
  }
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/format.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports.default = format;
  }
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/ajv/dist/vocabularies/metadata.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.contentVocabulary = exports.metadataVocabulary = void 0;
    exports.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft7.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports.default = draft7Vocabularies;
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports.DiscrError = DiscrError = {}));
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error: error2,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required: required2 }) {
            return Array.isArray(required2) && required2.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports, module) {
    module.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/ajv/dist/ajv.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv2 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports.Ajv = Ajv2;
    module.exports = exports = Ajv2;
    module.exports.Ajv = Ajv2;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = Ajv2;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  "node_modules/ajv-formats/dist/formats.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date3, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      "date-time": fmtDef(getDateTime(true), compareDateTime),
      "iso-time": fmtDef(getTime(), compareIsoTime),
      "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: "number", validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: "number", validate: validateInt64 },
      // C-type float
      float: { type: "number", validate: validateNumber },
      // C-type double
      double: { type: "number", validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true
    };
    exports.fastFormats = {
      ...exports.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
      "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
      "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
      "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    };
    exports.formatNames = Object.keys(exports.fullFormats);
    function isLeapYear(year) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }
    var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
    var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function date3(str) {
      const matches = DATE.exec(str);
      if (!matches)
        return false;
      const year = +matches[1];
      const month = +matches[2];
      const day = +matches[3];
      return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
    }
    function compareDate(d1, d2) {
      if (!(d1 && d2))
        return void 0;
      if (d1 > d2)
        return 1;
      if (d1 < d2)
        return -1;
      return 0;
    }
    var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function getTime(strictTimeZone) {
      return function time3(str) {
        const matches = TIME.exec(str);
        if (!matches)
          return false;
        const hr = +matches[1];
        const min = +matches[2];
        const sec = +matches[3];
        const tz = matches[4];
        const tzSign = matches[5] === "-" ? -1 : 1;
        const tzH = +(matches[6] || 0);
        const tzM = +(matches[7] || 0);
        if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
          return false;
        if (hr <= 23 && min <= 59 && sec < 60)
          return true;
        const utcMin = min - tzM * tzSign;
        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
      };
    }
    function compareTime(s1, s2) {
      if (!(s1 && s2))
        return void 0;
      const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
      const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
      if (!(t1 && t2))
        return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2))
        return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2))
        return void 0;
      t1 = a1[1] + a1[2] + a1[3];
      t2 = a2[1] + a2[2] + a2[3];
      if (t1 > t2)
        return 1;
      if (t1 < t2)
        return -1;
      return 0;
    }
    var DATE_TIME_SEPARATOR = /t|\s/i;
    function getDateTime(strictTimeZone) {
      const time3 = getTime(strictTimeZone);
      return function date_time(str) {
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && date3(dateTime[0]) && time3(dateTime[1]);
      };
    }
    function compareDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2))
        return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0)
        return void 0;
      return res || compareTime(t1, t2);
    }
    var NOT_URI_FRAGMENT = /\/|:/;
    var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function uri(str) {
      return NOT_URI_FRAGMENT.test(str) && URI.test(str);
    }
    var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function byte(str) {
      BYTE.lastIndex = 0;
      return BYTE.test(str);
    }
    var MIN_INT32 = -(2 ** 31);
    var MAX_INT32 = 2 ** 31 - 1;
    function validateInt32(value) {
      return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
    }
    function validateInt64(value) {
      return Number.isInteger(value);
    }
    function validateNumber() {
      return true;
    }
    var Z_ANCHOR = /[^\\]\\Z/;
    function regex(str) {
      if (Z_ANCHOR.test(str))
        return false;
      try {
        new RegExp(str);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
});

// node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS({
  "node_modules/ajv-formats/dist/limit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.formatLimitDefinition = void 0;
    var ajv_1 = require_ajv();
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error2 = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    exports.formatLimitDefinition = {
      keyword: Object.keys(KWDs),
      type: "string",
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, schemaCode, keyword, it } = cxt;
        const { opts, self } = it;
        if (!opts.validateFormats)
          return;
        const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
        if (fCxt.$data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
          cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
        }
        function validateFormat() {
          const format = fCxt.schema;
          const fmtDef = self.formats[format];
          if (!fmtDef || fmtDef === true)
            return;
          if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
            throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
          }
          const fmt = gen.scopeValue("formats", {
            key: format,
            ref: fmtDef,
            code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : void 0
          });
          cxt.fail$data(compareCode(fmt));
        }
        function compareCode(fmt) {
          return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
        }
      },
      dependencies: ["format"]
    };
    var formatLimitPlugin = (ajv) => {
      ajv.addKeyword(exports.formatLimitDefinition);
      return ajv;
    };
    exports.default = formatLimitPlugin;
  }
});

// node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS({
  "node_modules/ajv-formats/dist/index.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var formats_1 = require_formats();
    var limit_1 = require_limit();
    var codegen_1 = require_codegen();
    var fullName = new codegen_1.Name("fullFormats");
    var fastName = new codegen_1.Name("fastFormats");
    var formatsPlugin = (ajv, opts = { keywords: true }) => {
      if (Array.isArray(opts)) {
        addFormats(ajv, opts, formats_1.fullFormats, fullName);
        return ajv;
      }
      const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
      const list = opts.formats || formats_1.formatNames;
      addFormats(ajv, list, formats, exportName);
      if (opts.keywords)
        (0, limit_1.default)(ajv);
      return ajv;
    };
    formatsPlugin.get = (name, mode = "full") => {
      const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
      const f = formats[name];
      if (!f)
        throw new Error(`Unknown format "${name}"`);
      return f;
    };
    function addFormats(ajv, list, fs7, exportName) {
      var _a;
      var _b;
      (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : _b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`;
      for (const f of list)
        ajv.addFormat(f, fs7[f]);
    }
    module.exports = exports = formatsPlugin;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = formatsPlugin;
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js
function createDefaultAjvInstance() {
  const ajv = new import_ajv.default({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true
  });
  const addFormats = import_ajv_formats.default;
  addFormats(ajv);
  return ajv;
}
var import_ajv, import_ajv_formats, AjvJsonSchemaValidator;
var init_ajv_provider = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js"() {
    import_ajv = __toESM(require_ajv(), 1);
    import_ajv_formats = __toESM(require_dist(), 1);
    AjvJsonSchemaValidator = class {
      /**
       * Create an AJV validator
       *
       * @param ajv - Optional pre-configured AJV instance. If not provided, a default instance will be created.
       *
       * @example
       * ```typescript
       * // Use default configuration (recommended for most cases)
       * import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
       * const validator = new AjvJsonSchemaValidator();
       *
       * // Or provide custom AJV instance for advanced configuration
       * import { Ajv } from 'ajv';
       * import addFormats from 'ajv-formats';
       *
       * const ajv = new Ajv({ validateFormats: true });
       * addFormats(ajv);
       * const validator = new AjvJsonSchemaValidator(ajv);
       * ```
       */
      constructor(ajv) {
        this._ajv = ajv ?? createDefaultAjvInstance();
      }
      /**
       * Create a validator for the given JSON Schema
       *
       * The validator is compiled once and can be reused multiple times.
       * If the schema has an $id, it will be cached by AJV automatically.
       *
       * @param schema - Standard JSON Schema object
       * @returns A validator function that validates input data
       */
      getValidator(schema) {
        const ajvValidator = "$id" in schema && typeof schema.$id === "string" ? this._ajv.getSchema(schema.$id) ?? this._ajv.compile(schema) : this._ajv.compile(schema);
        return (input) => {
          const valid = ajvValidator(input);
          if (valid) {
            return {
              valid: true,
              data: input,
              errorMessage: void 0
            };
          } else {
            return {
              valid: false,
              data: void 0,
              errorMessage: this._ajv.errorsText(ajvValidator.errors)
            };
          }
        };
      }
    };
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/server.js
var ExperimentalServerTasks;
var init_server = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/server.js"() {
    init_types();
    ExperimentalServerTasks = class {
      constructor(_server) {
        this._server = _server;
      }
      /**
       * Sends a request and returns an AsyncGenerator that yields response messages.
       * The generator is guaranteed to end with either a 'result' or 'error' message.
       *
       * This method provides streaming access to request processing, allowing you to
       * observe intermediate task status updates for task-augmented requests.
       *
       * @param request - The request to send
       * @param resultSchema - Zod schema for validating the result
       * @param options - Optional request options (timeout, signal, task creation params, etc.)
       * @returns AsyncGenerator that yields ResponseMessage objects
       *
       * @experimental
       */
      requestStream(request, resultSchema, options) {
        return this._server.requestStream(request, resultSchema, options);
      }
      /**
       * Sends a sampling request and returns an AsyncGenerator that yields response messages.
       * The generator is guaranteed to end with either a 'result' or 'error' message.
       *
       * For task-augmented requests, yields 'taskCreated' and 'taskStatus' messages
       * before the final result.
       *
       * @example
       * ```typescript
       * const stream = server.experimental.tasks.createMessageStream({
       *     messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
       *     maxTokens: 100
       * }, {
       *     onprogress: (progress) => {
       *         // Handle streaming tokens via progress notifications
       *         console.log('Progress:', progress.message);
       *     }
       * });
       *
       * for await (const message of stream) {
       *     switch (message.type) {
       *         case 'taskCreated':
       *             console.log('Task created:', message.task.taskId);
       *             break;
       *         case 'taskStatus':
       *             console.log('Task status:', message.task.status);
       *             break;
       *         case 'result':
       *             console.log('Final result:', message.result);
       *             break;
       *         case 'error':
       *             console.error('Error:', message.error);
       *             break;
       *     }
       * }
       * ```
       *
       * @param params - The sampling request parameters
       * @param options - Optional request options (timeout, signal, task creation params, onprogress, etc.)
       * @returns AsyncGenerator that yields ResponseMessage objects
       *
       * @experimental
       */
      createMessageStream(params, options) {
        const clientCapabilities = this._server.getClientCapabilities();
        if ((params.tools || params.toolChoice) && !clientCapabilities?.sampling?.tools) {
          throw new Error("Client does not support sampling tools capability.");
        }
        if (params.messages.length > 0) {
          const lastMessage = params.messages[params.messages.length - 1];
          const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
          const hasToolResults = lastContent.some((c) => c.type === "tool_result");
          const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
          const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
          const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
          if (hasToolResults) {
            if (lastContent.some((c) => c.type !== "tool_result")) {
              throw new Error("The last message must contain only tool_result content if any is present");
            }
            if (!hasPreviousToolUse) {
              throw new Error("tool_result blocks are not matching any tool_use from the previous message");
            }
          }
          if (hasPreviousToolUse) {
            const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
            const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
            if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
              throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
            }
          }
        }
        return this.requestStream({
          method: "sampling/createMessage",
          params
        }, CreateMessageResultSchema, options);
      }
      /**
       * Sends an elicitation request and returns an AsyncGenerator that yields response messages.
       * The generator is guaranteed to end with either a 'result' or 'error' message.
       *
       * For task-augmented requests (especially URL-based elicitation), yields 'taskCreated'
       * and 'taskStatus' messages before the final result.
       *
       * @example
       * ```typescript
       * const stream = server.experimental.tasks.elicitInputStream({
       *     mode: 'url',
       *     message: 'Please authenticate',
       *     elicitationId: 'auth-123',
       *     url: 'https://example.com/auth'
       * }, {
       *     task: { ttl: 300000 } // Task-augmented for long-running auth flow
       * });
       *
       * for await (const message of stream) {
       *     switch (message.type) {
       *         case 'taskCreated':
       *             console.log('Task created:', message.task.taskId);
       *             break;
       *         case 'taskStatus':
       *             console.log('Task status:', message.task.status);
       *             break;
       *         case 'result':
       *             console.log('User action:', message.result.action);
       *             break;
       *         case 'error':
       *             console.error('Error:', message.error);
       *             break;
       *     }
       * }
       * ```
       *
       * @param params - The elicitation request parameters
       * @param options - Optional request options (timeout, signal, task creation params, etc.)
       * @returns AsyncGenerator that yields ResponseMessage objects
       *
       * @experimental
       */
      elicitInputStream(params, options) {
        const clientCapabilities = this._server.getClientCapabilities();
        const mode = params.mode ?? "form";
        switch (mode) {
          case "url": {
            if (!clientCapabilities?.elicitation?.url) {
              throw new Error("Client does not support url elicitation.");
            }
            break;
          }
          case "form": {
            if (!clientCapabilities?.elicitation?.form) {
              throw new Error("Client does not support form elicitation.");
            }
            break;
          }
        }
        const normalizedParams = mode === "form" && params.mode === void 0 ? { ...params, mode: "form" } : params;
        return this.requestStream({
          method: "elicitation/create",
          params: normalizedParams
        }, ElicitResultSchema, options);
      }
      /**
       * Gets the current status of a task.
       *
       * @param taskId - The task identifier
       * @param options - Optional request options
       * @returns The task status
       *
       * @experimental
       */
      async getTask(taskId, options) {
        return this._server.getTask({ taskId }, options);
      }
      /**
       * Retrieves the result of a completed task.
       *
       * @param taskId - The task identifier
       * @param resultSchema - Zod schema for validating the result
       * @param options - Optional request options
       * @returns The task result
       *
       * @experimental
       */
      async getTaskResult(taskId, resultSchema, options) {
        return this._server.getTaskResult({ taskId }, resultSchema, options);
      }
      /**
       * Lists tasks with optional pagination.
       *
       * @param cursor - Optional pagination cursor
       * @param options - Optional request options
       * @returns List of tasks with optional next cursor
       *
       * @experimental
       */
      async listTasks(cursor, options) {
        return this._server.listTasks(cursor ? { cursor } : void 0, options);
      }
      /**
       * Cancels a running task.
       *
       * @param taskId - The task identifier
       * @param options - Optional request options
       *
       * @experimental
       */
      async cancelTask(taskId, options) {
        return this._server.cancelTask({ taskId }, options);
      }
    };
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js
function assertToolsCallTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "tools/call":
      if (!requests.tools?.call) {
        throw new Error(`${entityName} does not support task creation for tools/call (required for ${method})`);
      }
      break;
    default:
      break;
  }
}
function assertClientRequestTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "sampling/createMessage":
      if (!requests.sampling?.createMessage) {
        throw new Error(`${entityName} does not support task creation for sampling/createMessage (required for ${method})`);
      }
      break;
    case "elicitation/create":
      if (!requests.elicitation?.create) {
        throw new Error(`${entityName} does not support task creation for elicitation/create (required for ${method})`);
      }
      break;
    default:
      break;
  }
}
var init_helpers = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js"() {
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js
var Server;
var init_server2 = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js"() {
    init_protocol();
    init_types();
    init_ajv_provider();
    init_zod_compat();
    init_server();
    init_helpers();
    Server = class extends Protocol {
      /**
       * Initializes this server with the given name and version information.
       */
      constructor(_serverInfo, options) {
        super(options);
        this._serverInfo = _serverInfo;
        this._loggingLevels = /* @__PURE__ */ new Map();
        this.LOG_LEVEL_SEVERITY = new Map(LoggingLevelSchema.options.map((level, index) => [level, index]));
        this.isMessageIgnored = (level, sessionId) => {
          const currentLevel = this._loggingLevels.get(sessionId);
          return currentLevel ? this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(currentLevel) : false;
        };
        this._capabilities = options?.capabilities ?? {};
        this._instructions = options?.instructions;
        this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator();
        this.setRequestHandler(InitializeRequestSchema, (request) => this._oninitialize(request));
        this.setNotificationHandler(InitializedNotificationSchema, () => this.oninitialized?.());
        if (this._capabilities.logging) {
          this.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
            const transportSessionId = extra.sessionId || extra.requestInfo?.headers["mcp-session-id"] || void 0;
            const { level } = request.params;
            const parseResult = LoggingLevelSchema.safeParse(level);
            if (parseResult.success) {
              this._loggingLevels.set(transportSessionId, parseResult.data);
            }
            return {};
          });
        }
      }
      /**
       * Access experimental features.
       *
       * WARNING: These APIs are experimental and may change without notice.
       *
       * @experimental
       */
      get experimental() {
        if (!this._experimental) {
          this._experimental = {
            tasks: new ExperimentalServerTasks(this)
          };
        }
        return this._experimental;
      }
      /**
       * Registers new capabilities. This can only be called before connecting to a transport.
       *
       * The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
       */
      registerCapabilities(capabilities) {
        if (this.transport) {
          throw new Error("Cannot register capabilities after connecting to transport");
        }
        this._capabilities = mergeCapabilities(this._capabilities, capabilities);
      }
      /**
       * Override request handler registration to enforce server-side validation for tools/call.
       */
      setRequestHandler(requestSchema, handler) {
        const shape = getObjectShape(requestSchema);
        const methodSchema = shape?.method;
        if (!methodSchema) {
          throw new Error("Schema is missing a method literal");
        }
        let methodValue;
        if (isZ4Schema(methodSchema)) {
          const v4Schema = methodSchema;
          const v4Def = v4Schema._zod?.def;
          methodValue = v4Def?.value ?? v4Schema.value;
        } else {
          const v3Schema = methodSchema;
          const legacyDef = v3Schema._def;
          methodValue = legacyDef?.value ?? v3Schema.value;
        }
        if (typeof methodValue !== "string") {
          throw new Error("Schema method literal must be a string");
        }
        const method = methodValue;
        if (method === "tools/call") {
          const wrappedHandler = async (request, extra) => {
            const validatedRequest = safeParse2(CallToolRequestSchema, request);
            if (!validatedRequest.success) {
              const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
              throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${errorMessage}`);
            }
            const { params } = validatedRequest.data;
            const result = await Promise.resolve(handler(request, extra));
            if (params.task) {
              const taskValidationResult = safeParse2(CreateTaskResultSchema, result);
              if (!taskValidationResult.success) {
                const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
                throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
              }
              return taskValidationResult.data;
            }
            const validationResult = safeParse2(CallToolResultSchema, result);
            if (!validationResult.success) {
              const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
              throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${errorMessage}`);
            }
            return validationResult.data;
          };
          return super.setRequestHandler(requestSchema, wrappedHandler);
        }
        return super.setRequestHandler(requestSchema, handler);
      }
      assertCapabilityForMethod(method) {
        switch (method) {
          case "sampling/createMessage":
            if (!this._clientCapabilities?.sampling) {
              throw new Error(`Client does not support sampling (required for ${method})`);
            }
            break;
          case "elicitation/create":
            if (!this._clientCapabilities?.elicitation) {
              throw new Error(`Client does not support elicitation (required for ${method})`);
            }
            break;
          case "roots/list":
            if (!this._clientCapabilities?.roots) {
              throw new Error(`Client does not support listing roots (required for ${method})`);
            }
            break;
          case "ping":
            break;
        }
      }
      assertNotificationCapability(method) {
        switch (method) {
          case "notifications/message":
            if (!this._capabilities.logging) {
              throw new Error(`Server does not support logging (required for ${method})`);
            }
            break;
          case "notifications/resources/updated":
          case "notifications/resources/list_changed":
            if (!this._capabilities.resources) {
              throw new Error(`Server does not support notifying about resources (required for ${method})`);
            }
            break;
          case "notifications/tools/list_changed":
            if (!this._capabilities.tools) {
              throw new Error(`Server does not support notifying of tool list changes (required for ${method})`);
            }
            break;
          case "notifications/prompts/list_changed":
            if (!this._capabilities.prompts) {
              throw new Error(`Server does not support notifying of prompt list changes (required for ${method})`);
            }
            break;
          case "notifications/elicitation/complete":
            if (!this._clientCapabilities?.elicitation?.url) {
              throw new Error(`Client does not support URL elicitation (required for ${method})`);
            }
            break;
          case "notifications/cancelled":
            break;
          case "notifications/progress":
            break;
        }
      }
      assertRequestHandlerCapability(method) {
        if (!this._capabilities) {
          return;
        }
        switch (method) {
          case "completion/complete":
            if (!this._capabilities.completions) {
              throw new Error(`Server does not support completions (required for ${method})`);
            }
            break;
          case "logging/setLevel":
            if (!this._capabilities.logging) {
              throw new Error(`Server does not support logging (required for ${method})`);
            }
            break;
          case "prompts/get":
          case "prompts/list":
            if (!this._capabilities.prompts) {
              throw new Error(`Server does not support prompts (required for ${method})`);
            }
            break;
          case "resources/list":
          case "resources/templates/list":
          case "resources/read":
            if (!this._capabilities.resources) {
              throw new Error(`Server does not support resources (required for ${method})`);
            }
            break;
          case "tools/call":
          case "tools/list":
            if (!this._capabilities.tools) {
              throw new Error(`Server does not support tools (required for ${method})`);
            }
            break;
          case "tasks/get":
          case "tasks/list":
          case "tasks/result":
          case "tasks/cancel":
            if (!this._capabilities.tasks) {
              throw new Error(`Server does not support tasks capability (required for ${method})`);
            }
            break;
          case "ping":
          case "initialize":
            break;
        }
      }
      assertTaskCapability(method) {
        assertClientRequestTaskCapability(this._clientCapabilities?.tasks?.requests, method, "Client");
      }
      assertTaskHandlerCapability(method) {
        if (!this._capabilities) {
          return;
        }
        assertToolsCallTaskCapability(this._capabilities.tasks?.requests, method, "Server");
      }
      async _oninitialize(request) {
        const requestedVersion = request.params.protocolVersion;
        this._clientCapabilities = request.params.capabilities;
        this._clientVersion = request.params.clientInfo;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : LATEST_PROTOCOL_VERSION;
        return {
          protocolVersion,
          capabilities: this.getCapabilities(),
          serverInfo: this._serverInfo,
          ...this._instructions && { instructions: this._instructions }
        };
      }
      /**
       * After initialization has completed, this will be populated with the client's reported capabilities.
       */
      getClientCapabilities() {
        return this._clientCapabilities;
      }
      /**
       * After initialization has completed, this will be populated with information about the client's name and version.
       */
      getClientVersion() {
        return this._clientVersion;
      }
      getCapabilities() {
        return this._capabilities;
      }
      async ping() {
        return this.request({ method: "ping" }, EmptyResultSchema);
      }
      // Implementation
      async createMessage(params, options) {
        if (params.tools || params.toolChoice) {
          if (!this._clientCapabilities?.sampling?.tools) {
            throw new Error("Client does not support sampling tools capability.");
          }
        }
        if (params.messages.length > 0) {
          const lastMessage = params.messages[params.messages.length - 1];
          const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
          const hasToolResults = lastContent.some((c) => c.type === "tool_result");
          const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
          const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
          const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
          if (hasToolResults) {
            if (lastContent.some((c) => c.type !== "tool_result")) {
              throw new Error("The last message must contain only tool_result content if any is present");
            }
            if (!hasPreviousToolUse) {
              throw new Error("tool_result blocks are not matching any tool_use from the previous message");
            }
          }
          if (hasPreviousToolUse) {
            const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
            const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
            if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
              throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
            }
          }
        }
        if (params.tools) {
          return this.request({ method: "sampling/createMessage", params }, CreateMessageResultWithToolsSchema, options);
        }
        return this.request({ method: "sampling/createMessage", params }, CreateMessageResultSchema, options);
      }
      /**
       * Creates an elicitation request for the given parameters.
       * For backwards compatibility, `mode` may be omitted for form requests and will default to `'form'`.
       * @param params The parameters for the elicitation request.
       * @param options Optional request options.
       * @returns The result of the elicitation request.
       */
      async elicitInput(params, options) {
        const mode = params.mode ?? "form";
        switch (mode) {
          case "url": {
            if (!this._clientCapabilities?.elicitation?.url) {
              throw new Error("Client does not support url elicitation.");
            }
            const urlParams = params;
            return this.request({ method: "elicitation/create", params: urlParams }, ElicitResultSchema, options);
          }
          case "form": {
            if (!this._clientCapabilities?.elicitation?.form) {
              throw new Error("Client does not support form elicitation.");
            }
            const formParams = params.mode === "form" ? params : { ...params, mode: "form" };
            const result = await this.request({ method: "elicitation/create", params: formParams }, ElicitResultSchema, options);
            if (result.action === "accept" && result.content && formParams.requestedSchema) {
              try {
                const validator = this._jsonSchemaValidator.getValidator(formParams.requestedSchema);
                const validationResult = validator(result.content);
                if (!validationResult.valid) {
                  throw new McpError(ErrorCode.InvalidParams, `Elicitation response content does not match requested schema: ${validationResult.errorMessage}`);
                }
              } catch (error2) {
                if (error2 instanceof McpError) {
                  throw error2;
                }
                throw new McpError(ErrorCode.InternalError, `Error validating elicitation response: ${error2 instanceof Error ? error2.message : String(error2)}`);
              }
            }
            return result;
          }
        }
      }
      /**
       * Creates a reusable callback that, when invoked, will send a `notifications/elicitation/complete`
       * notification for the specified elicitation ID.
       *
       * @param elicitationId The ID of the elicitation to mark as complete.
       * @param options Optional notification options. Useful when the completion notification should be related to a prior request.
       * @returns A function that emits the completion notification when awaited.
       */
      createElicitationCompletionNotifier(elicitationId, options) {
        if (!this._clientCapabilities?.elicitation?.url) {
          throw new Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
        }
        return () => this.notification({
          method: "notifications/elicitation/complete",
          params: {
            elicitationId
          }
        }, options);
      }
      async listRoots(params, options) {
        return this.request({ method: "roots/list", params }, ListRootsResultSchema, options);
      }
      /**
       * Sends a logging message to the client, if connected.
       * Note: You only need to send the parameters object, not the entire JSON RPC message
       * @see LoggingMessageNotification
       * @param params
       * @param sessionId optional for stateless and backward compatibility
       */
      async sendLoggingMessage(params, sessionId) {
        if (this._capabilities.logging) {
          if (!this.isMessageIgnored(params.level, sessionId)) {
            return this.notification({ method: "notifications/message", params });
          }
        }
      }
      async sendResourceUpdated(params) {
        return this.notification({
          method: "notifications/resources/updated",
          params
        });
      }
      async sendResourceListChanged() {
        return this.notification({
          method: "notifications/resources/list_changed"
        });
      }
      async sendToolListChanged() {
        return this.notification({ method: "notifications/tools/list_changed" });
      }
      async sendPromptListChanged() {
        return this.notification({ method: "notifications/prompts/list_changed" });
      }
    };
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js
function deserializeMessage(line) {
  return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
  return JSON.stringify(message) + "\n";
}
var ReadBuffer;
var init_stdio = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js"() {
    init_types();
    ReadBuffer = class {
      append(chunk) {
        this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
      }
      readMessage() {
        if (!this._buffer) {
          return null;
        }
        const index = this._buffer.indexOf("\n");
        if (index === -1) {
          return null;
        }
        const line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
        this._buffer = this._buffer.subarray(index + 1);
        return deserializeMessage(line);
      }
      clear() {
        this._buffer = void 0;
      }
    };
  }
});

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
import process2 from "node:process";
var StdioServerTransport;
var init_stdio2 = __esm({
  "node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"() {
    init_stdio();
    StdioServerTransport = class {
      constructor(_stdin = process2.stdin, _stdout = process2.stdout) {
        this._stdin = _stdin;
        this._stdout = _stdout;
        this._readBuffer = new ReadBuffer();
        this._started = false;
        this._ondata = (chunk) => {
          this._readBuffer.append(chunk);
          this.processReadBuffer();
        };
        this._onerror = (error2) => {
          this.onerror?.(error2);
        };
      }
      /**
       * Starts listening for messages on stdin.
       */
      async start() {
        if (this._started) {
          throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
        }
        this._started = true;
        this._stdin.on("data", this._ondata);
        this._stdin.on("error", this._onerror);
      }
      processReadBuffer() {
        while (true) {
          try {
            const message = this._readBuffer.readMessage();
            if (message === null) {
              break;
            }
            this.onmessage?.(message);
          } catch (error2) {
            this.onerror?.(error2);
          }
        }
      }
      async close() {
        this._stdin.off("data", this._ondata);
        this._stdin.off("error", this._onerror);
        const remainingDataListeners = this._stdin.listenerCount("data");
        if (remainingDataListeners === 0) {
          this._stdin.pause();
        }
        this._readBuffer.clear();
        this.onclose?.();
      }
      send(message) {
        return new Promise((resolve3) => {
          const json = serializeMessage(message);
          if (this._stdout.write(json)) {
            resolve3();
          } else {
            this._stdout.once("drain", resolve3);
          }
        });
      }
    };
  }
});

// src/utils.ts
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
function getProjectRoot() {
  const markers = [".git", "package.json", "Plans.md", ".claude"];
  let current = process.cwd();
  const { root } = path.parse(current);
  while (current !== root) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }
  return process.cwd();
}
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
function safeReadJSON(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    console.error(`[harness-mcp] Failed to parse JSON from ${filePath}: ${message}`);
    return defaultValue;
  }
}
function safeWriteJSON(filePath, data) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    console.error(`[harness-mcp] Failed to write JSON to ${filePath}: ${message}`);
    return false;
  }
}
function isValidPath(inputPath) {
  if (!inputPath || inputPath.trim() === "") {
    return false;
  }
  const dangerousChars = /[;&|`$(){}[\]<>'"\\!#*?~\n\r]/;
  if (dangerousChars.test(inputPath)) {
    return false;
  }
  if (inputPath.includes("\0")) {
    return false;
  }
  const normalized = path.normalize(inputPath);
  if (normalized.startsWith("..")) {
    return false;
  }
  return true;
}
async function getRecentChangesAsync(basePath) {
  if (basePath !== void 0 && !isValidPath(basePath)) {
    console.error(`[harness-mcp] Invalid path rejected: ${basePath}`);
    return [];
  }
  const cwd = basePath || getProjectRoot();
  if (!fs.existsSync(cwd)) {
    return [];
  }
  try {
    const { stdout } = await execAsync("git diff --name-only HEAD~1", {
      cwd,
      encoding: "utf-8"
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
function formatTimeAgo(seconds) {
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}
var execAsync, STALE_THRESHOLD_SECONDS, MAX_BROADCAST_MESSAGES, SESSIONS_DIR, ACTIVE_SESSIONS_FILE, BROADCAST_FILE;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    execAsync = promisify(exec);
    STALE_THRESHOLD_SECONDS = 3600;
    MAX_BROADCAST_MESSAGES = 100;
    SESSIONS_DIR = ".claude/sessions";
    ACTIVE_SESSIONS_FILE = `${SESSIONS_DIR}/active.json`;
    BROADCAST_FILE = `${SESSIONS_DIR}/broadcast.md`;
  }
});

// src/tools/session.ts
import * as fs2 from "fs";
function isBroadcastArgs(args) {
  return typeof args === "object" && args !== null && "message" in args && typeof args.message === "string";
}
function isInboxArgs(args) {
  if (args === void 0 || args === null) return true;
  if (typeof args !== "object") return false;
  const obj = args;
  return obj.since === void 0 || typeof obj.since === "string";
}
function isRegisterArgs(args) {
  return typeof args === "object" && args !== null && "client" in args && "sessionId" in args && typeof args.client === "string" && typeof args.sessionId === "string";
}
function isValidSessionId(id) {
  return SAFE_ID_PATTERN.test(id);
}
function isValidClientName(name) {
  return SAFE_ID_PATTERN.test(name);
}
function initSessionsDir() {
  if (!sessionsInitialized) {
    ensureDir(SESSIONS_DIR);
    sessionsInitialized = true;
  }
}
function loadSessions() {
  initSessionsDir();
  return safeReadJSON(ACTIVE_SESSIONS_FILE, {});
}
function saveSessions(sessions) {
  initSessionsDir();
  safeWriteJSON(ACTIVE_SESSIONS_FILE, sessions);
}
function loadBroadcasts() {
  initSessionsDir();
  if (!fs2.existsSync(BROADCAST_FILE)) {
    return [];
  }
  try {
    const content = fs2.readFileSync(BROADCAST_FILE, "utf-8");
    const messages = [];
    const regex = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \[([^\]]+)\]\n(.+?)(?=\n## |\n*$)/gms;
    let match;
    while ((match = regex.exec(content)) !== null) {
      messages.push({
        timestamp: match[1],
        sessionId: match[2],
        client: "cli",
        // CLI messages don't have client info
        message: match[3].trim()
      });
    }
    return messages;
  } catch {
    return [];
  }
}
function appendBroadcast(msg) {
  initSessionsDir();
  const entry = `## ${msg.timestamp} [${msg.sessionId}]
${msg.message}

`;
  try {
    fs2.appendFileSync(BROADCAST_FILE, entry);
    setImmediate(() => {
      try {
        const messages = loadBroadcasts();
        if (messages.length > MAX_BROADCAST_MESSAGES) {
          const trimmed = messages.slice(-MAX_BROADCAST_MESSAGES);
          const content = trimmed.map((m) => `## ${m.timestamp} [${m.sessionId}]
${m.message}
`).join("\n");
          fs2.writeFileSync(BROADCAST_FILE, content);
        }
      } catch (trimError) {
        console.error(`[harness-mcp] Failed to trim broadcasts: ${trimError}`);
      }
    });
  } catch (error2) {
    console.error(`[harness-mcp] Failed to append broadcast: ${error2}`);
  }
}
async function handleSessionTool(name, args) {
  switch (name) {
    case "harness_session_list":
      return handleListSessions();
    case "harness_session_broadcast":
      if (!isBroadcastArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for broadcast" }],
          isError: true
        };
      }
      return handleBroadcast(args);
    case "harness_session_inbox":
      if (!isInboxArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for inbox" }],
          isError: true
        };
      }
      return handleInbox(args ?? {});
    case "harness_session_register":
      if (!isRegisterArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for register" }],
          isError: true
        };
      }
      return handleRegister(args);
    default:
      return {
        content: [{ type: "text", text: `Unknown session tool: ${name}` }],
        isError: true
      };
  }
}
function handleListSessions() {
  const sessions = loadSessions();
  const now = Date.now() / 1e3;
  const activeSessions = Object.entries(sessions).filter(([_, session]) => now - session.lastSeen < STALE_THRESHOLD_SECONDS).map(([_id, session]) => {
    const age = Math.floor(now - session.lastSeen);
    return `- ${session.id.slice(0, 12)} (${session.client}) - ${formatTimeAgo(age)}`;
  });
  const text = activeSessions.length > 0 ? `\u{1F4CB} Active Sessions:
${activeSessions.join("\n")}` : "\u{1F4CB} No active sessions found";
  return { content: [{ type: "text", text }] };
}
function handleBroadcast(args) {
  const { message } = args;
  if (!message) {
    return {
      content: [{ type: "text", text: "Error: message is required" }],
      isError: true
    };
  }
  const newMessage = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    // Remove milliseconds for CLI compatibility
    sessionId: process.env.HARNESS_SESSION_ID || "mcp-session",
    client: process.env.HARNESS_CLIENT || "mcp",
    message
  };
  appendBroadcast(newMessage);
  return {
    content: [
      {
        type: "text",
        text: `\u{1F4E4} Broadcast sent: "${message}"`
      }
    ]
  };
}
function handleInbox(args) {
  const broadcasts = loadBroadcasts();
  const since = args.since ? new Date(args.since).getTime() : Date.now() - DEFAULT_INBOX_WINDOW_MS;
  const unread = broadcasts.filter(
    (msg) => new Date(msg.timestamp).getTime() > since
  );
  if (unread.length === 0) {
    return { content: [{ type: "text", text: "\u{1F4E8} No new messages" }] };
  }
  const formatted = unread.map((msg) => {
    const time3 = new Date(msg.timestamp).toLocaleTimeString();
    return `[${time3}] ${msg.client}: ${msg.message}`;
  }).join("\n");
  return {
    content: [
      {
        type: "text",
        text: `\u{1F4E8} ${unread.length} message(s):
${formatted}`
      }
    ]
  };
}
function handleRegister(args) {
  const { client, sessionId } = args;
  if (!client || !sessionId) {
    return {
      content: [
        { type: "text", text: "Error: client and sessionId are required" }
      ],
      isError: true
    };
  }
  if (!isValidSessionId(sessionId)) {
    return {
      content: [
        { type: "text", text: "Error: sessionId must be alphanumeric with dashes/underscores (1-128 chars)" }
      ],
      isError: true
    };
  }
  if (!isValidClientName(client)) {
    return {
      content: [
        { type: "text", text: "Error: client must be alphanumeric with dashes/underscores (1-128 chars)" }
      ],
      isError: true
    };
  }
  const sessions = loadSessions();
  sessions[sessionId] = {
    id: sessionId,
    client,
    lastSeen: Date.now() / 1e3,
    pid: process.pid.toString()
  };
  saveSessions(sessions);
  process.env.HARNESS_SESSION_ID = sessionId;
  process.env.HARNESS_CLIENT = client;
  return {
    content: [
      {
        type: "text",
        text: `\u2705 Session registered: ${sessionId} (${client})`
      }
    ]
  };
}
var SAFE_ID_PATTERN, sessionTools, sessionsInitialized, DEFAULT_INBOX_WINDOW_MS;
var init_session = __esm({
  "src/tools/session.ts"() {
    "use strict";
    init_utils();
    SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
    sessionTools = [
      {
        name: "harness_session_list",
        description: "List all active Harness sessions across different AI clients (Claude Code, Codex, etc.)",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "harness_session_broadcast",
        description: "Broadcast a message to all active sessions. Use this to notify other sessions about important changes (API modifications, schema updates, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to broadcast to all sessions"
            }
          },
          required: ["message"]
        }
      },
      {
        name: "harness_session_inbox",
        description: "Check inbox for messages from other sessions. Returns unread messages since last check.",
        inputSchema: {
          type: "object",
          properties: {
            since: {
              type: "string",
              description: "ISO timestamp to get messages since (optional)"
            }
          },
          required: []
        }
      },
      {
        name: "harness_session_register",
        description: "Register current session with the Harness MCP server. Call this when starting a new session.",
        inputSchema: {
          type: "object",
          properties: {
            client: {
              type: "string",
              description: "Client name (e.g., 'claude-code', 'codex', 'cursor')"
            },
            sessionId: {
              type: "string",
              description: "Unique session identifier"
            }
          },
          required: ["client", "sessionId"]
        }
      }
    ];
    sessionsInitialized = false;
    DEFAULT_INBOX_WINDOW_MS = 36e5;
  }
});

// src/tools/workflow.ts
import * as fs3 from "fs";
import * as path2 from "path";
function readPlans() {
  const plansPath = path2.join(getProjectRoot(), "Plans.md");
  if (fs3.existsSync(plansPath)) {
    return fs3.readFileSync(plansPath, "utf-8");
  }
  return null;
}
function generatePlanTemplate(task, mode) {
  return `
## Plan: ${task}

### Tasks

- [ ] **Task 1**: Analyze requirements <!-- cc:TODO -->
- [ ] **Task 2**: Implement core functionality <!-- cc:TODO -->
- [ ] **Task 3**: Add tests <!-- cc:TODO -->
- [ ] **Task 4**: Documentation <!-- cc:TODO -->

### Notes

- Created via MCP: harness_workflow_plan
- Mode: ${mode}
- Created at: ${(/* @__PURE__ */ new Date()).toISOString()}

---

\u{1F4A1} **Next Step**: Use \`harness_workflow_work\` to start implementation
`;
}
async function handleWorkflowTool(name, args) {
  switch (name) {
    case "harness_workflow_plan":
      return handlePlan(args);
    case "harness_workflow_work":
      return handleWork(
        args
      );
    case "harness_workflow_review":
      return await handleReview(
        args
      );
    default:
      return {
        content: [{ type: "text", text: `Unknown workflow tool: ${name}` }],
        isError: true
      };
  }
}
function handlePlan(args) {
  const { task, mode = "quick" } = args;
  if (!task) {
    return {
      content: [{ type: "text", text: "Error: task description is required" }],
      isError: true
    };
  }
  const planTemplate = generatePlanTemplate(task, mode);
  const plansPath = path2.join(getProjectRoot(), "Plans.md");
  const existingContent = fs3.existsSync(plansPath) ? fs3.readFileSync(plansPath, "utf-8") : "# Plans\n\n";
  fs3.writeFileSync(plansPath, existingContent + planTemplate);
  return {
    content: [
      {
        type: "text",
        text: `\u{1F4CB} Plan created for: "${task}"

Tasks added to Plans.md:
- Task 1: Analyze requirements
- Task 2: Implement core functionality
- Task 3: Add tests
- Task 4: Documentation

\u{1F4A1} Run harness_workflow_work to start implementation`
      }
    ]
  };
}
function handleWork(args) {
  const { parallel = 1, full = false, taskId } = args;
  const plans = readPlans();
  if (!plans) {
    return {
      content: [
        {
          type: "text",
          text: "\u274C Plans.md not found. Use harness_workflow_plan to create a plan first."
        }
      ]
    };
  }
  const todoCount = (plans.match(/cc:TODO/g) || []).length;
  const wipCount = (plans.match(/cc:WIP/g) || []).length;
  if (todoCount === 0 && wipCount === 0) {
    return {
      content: [
        {
          type: "text",
          text: "\u2705 No pending tasks in Plans.md. All done!"
        }
      ]
    };
  }
  const workMode = full ? "full cycle (implement \u2192 review \u2192 fix \u2192 commit)" : "implementation only";
  const parallelInfo = parallel > 1 ? `with ${parallel} parallel workers` : "sequentially";
  return {
    content: [
      {
        type: "text",
        text: `\u{1F527} Work Mode: ${workMode} ${parallelInfo}

\u{1F4CA} Task Status:
- TODO: ${todoCount}
- WIP: ${wipCount}

${taskId ? `\u{1F3AF} Targeting task: ${taskId}` : "\u{1F3AF} Will process next available task"}

\u26A1 To execute, the AI client should:
1. Read Plans.md to find cc:TODO tasks
2. Mark task as cc:WIP
3. Implement the task
4. ${full ? "Self-review and fix issues" : "Mark as cc:DONE"}
5. ${full ? "Commit changes" : ""}

\u{1F4A1} This tool provides work instructions. The actual implementation
   should be performed by the AI client using its native capabilities.`
      }
    ]
  };
}
async function handleReview(args) {
  const { files, focus = [], ci = false } = args;
  const targetFiles = files || await getRecentChangesAsync();
  if (targetFiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "\u274C No files to review. Specify files or make some changes first."
        }
      ]
    };
  }
  const activePerps = focus.length > 0 ? REVIEW_PERSPECTIVES.filter(
    (p) => focus.some((f) => p.name.toLowerCase().includes(f.toLowerCase()))
  ) : REVIEW_PERSPECTIVES;
  const reviewInstructions = activePerps.map((p) => `${p.emoji} **${p.name}**: Check for ${p.focus}`).join("\n");
  const output = ci ? JSON.stringify({
    files: targetFiles,
    perspectives: activePerps.map((p) => p.name),
    status: "pending"
  }) : `\u{1F50D} **Harness Code Review**

\u{1F4C1} Files to review (${targetFiles.length}):
${targetFiles.map((f) => `- ${f}`).join("\n")}

\u{1F465} Review Perspectives (${activePerps.length}):
${reviewInstructions}

\u26A1 To execute review, the AI client should:
1. Read each file listed above
2. Analyze from each perspective
3. Generate findings with severity (critical/warning/info)
4. Provide actionable recommendations

\u{1F4A1} This tool provides review instructions. The actual review
   should be performed by the AI client using its native capabilities.`;
  return {
    content: [{ type: "text", text: output }]
  };
}
var workflowTools, REVIEW_PERSPECTIVES;
var init_workflow = __esm({
  "src/tools/workflow.ts"() {
    "use strict";
    init_utils();
    workflowTools = [
      {
        name: "harness_workflow_plan",
        description: "Create an implementation plan for a task. Generates structured tasks in Plans.md",
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "Description of what you want to build or implement"
            },
            mode: {
              type: "string",
              enum: ["quick", "detailed"],
              description: "Planning mode: quick (minimal) or detailed (comprehensive)"
            }
          },
          required: ["task"]
        }
      },
      {
        name: "harness_workflow_work",
        description: "Execute tasks from Plans.md. Implements tasks marked as cc:TODO",
        inputSchema: {
          type: "object",
          properties: {
            parallel: {
              type: "number",
              description: "Number of parallel workers (1-5)"
            },
            full: {
              type: "boolean",
              description: "Run full cycle: implement \u2192 self-review \u2192 fix \u2192 commit"
            },
            taskId: {
              type: "string",
              description: "Specific task ID to work on (optional)"
            }
          },
          required: []
        }
      },
      {
        name: "harness_workflow_review",
        description: "Run multi-perspective code review. 8 expert reviewers analyze your code in parallel",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Specific files to review (optional, defaults to recent changes)"
            },
            focus: {
              type: "array",
              items: { type: "string" },
              description: "Review focus areas: security, performance, accessibility, etc."
            },
            ci: {
              type: "boolean",
              description: "CI mode: output machine-readable results"
            }
          },
          required: []
        }
      }
    ];
    REVIEW_PERSPECTIVES = [
      { name: "Security", emoji: "\u{1F512}", focus: "vulnerabilities, auth, injection" },
      { name: "Performance", emoji: "\u26A1", focus: "bottlenecks, memory, complexity" },
      { name: "Accessibility", emoji: "\u267F", focus: "WCAG, screen readers, keyboard" },
      { name: "Maintainability", emoji: "\u{1F9F9}", focus: "readability, coupling, DRY" },
      { name: "Testing", emoji: "\u{1F9EA}", focus: "coverage, edge cases, mocking" },
      { name: "Error Handling", emoji: "\u26A0\uFE0F", focus: "exceptions, validation, recovery" },
      { name: "Documentation", emoji: "\u{1F4DA}", focus: "comments, README, API docs" },
      { name: "Best Practices", emoji: "\u2728", focus: "patterns, conventions, idioms" }
    ];
  }
});

// src/tools/status.ts
import * as fs4 from "fs";
import * as path3 from "path";
function getPlansStatus() {
  const plansPath = path3.join(getProjectRoot(), "Plans.md");
  if (!fs4.existsSync(plansPath)) {
    return null;
  }
  const content = fs4.readFileSync(plansPath, "utf-8");
  return {
    todo: (content.match(/cc:TODO/g) || []).length,
    wip: (content.match(/cc:WIP/g) || []).length,
    done: (content.match(/cc:DONE/g) || []).length
  };
}
function getSessionCount() {
  const sessions = safeReadJSON(ACTIVE_SESSIONS_FILE, {});
  const now = Date.now() / 1e3;
  return Object.values(sessions).filter(
    (s) => now - s.lastSeen < STALE_THRESHOLD_SECONDS
  ).length;
}
function getUnreadMessageCount() {
  const messages = safeReadJSON(BROADCAST_FILE, []);
  const cutoff = Date.now() - MESSAGE_WINDOW_MS;
  return messages.filter(
    (m) => new Date(m.timestamp).getTime() > cutoff
  ).length;
}
function getHarnessVersion() {
  const versionFile = path3.join(getProjectRoot(), ".claude-code-harness-version");
  if (fs4.existsSync(versionFile)) {
    return fs4.readFileSync(versionFile, "utf-8").trim();
  }
  return null;
}
async function handleStatusTool(name, args) {
  switch (name) {
    case "harness_status":
      return handleStatus(args);
    default:
      return {
        content: [{ type: "text", text: `Unknown status tool: ${name}` }],
        isError: true
      };
  }
}
function handleStatus(args) {
  const { verbose = false } = args;
  const projectRoot = getProjectRoot();
  const plansStatus = getPlansStatus();
  const sessionCount = getSessionCount();
  const unreadCount = getUnreadMessageCount();
  const harnessVersion = getHarnessVersion();
  let status = `\u{1F4CA} **Harness Status**

`;
  status += `\u{1F4C1} Project: ${path3.basename(projectRoot)}
`;
  if (harnessVersion) {
    status += `\u{1F527} Harness: v${harnessVersion}
`;
  }
  status += `
`;
  if (plansStatus) {
    const total = plansStatus.todo + plansStatus.wip + plansStatus.done;
    const progress = total > 0 ? Math.round(plansStatus.done / total * 100) : 0;
    status += `\u{1F4CB} **Plans.md**
`;
    status += `\u251C\u2500 TODO: ${plansStatus.todo}
`;
    status += `\u251C\u2500 WIP: ${plansStatus.wip}
`;
    status += `\u251C\u2500 Done: ${plansStatus.done}
`;
    status += `\u2514\u2500 Progress: ${progress}%

`;
  } else {
    status += `\u{1F4CB} Plans.md: Not found

`;
  }
  status += `\u{1F465} **Sessions**
`;
  status += `\u251C\u2500 Active: ${sessionCount}
`;
  status += `\u2514\u2500 Unread messages: ${unreadCount}

`;
  if (verbose) {
    status += `\u{1F4CD} **Project Root**: ${projectRoot}
`;
    status += `
\u{1F4C4} **SSOT Files**:
`;
    for (const file of SSOT_FILES) {
      const exists = fs4.existsSync(path3.join(projectRoot, file));
      status += `${exists ? "\u2705" : "\u274C"} ${file}
`;
    }
  }
  status += `
\u{1F4A1} **Suggested Action**: `;
  if (!plansStatus) {
    status += `Use harness_workflow_plan to create a plan`;
  } else if (plansStatus.todo > 0) {
    status += `Use harness_workflow_work to implement ${plansStatus.todo} pending task(s)`;
  } else if (plansStatus.wip > 0) {
    status += `Continue working on ${plansStatus.wip} in-progress task(s)`;
  } else {
    status += `All tasks complete! Use harness_workflow_review to review changes`;
  }
  return {
    content: [{ type: "text", text: status }]
  };
}
var MESSAGE_WINDOW_MS, statusTools, SSOT_FILES;
var init_status = __esm({
  "src/tools/status.ts"() {
    "use strict";
    init_utils();
    MESSAGE_WINDOW_MS = 36e5;
    statusTools = [
      {
        name: "harness_status",
        description: "Get current project status including Plans.md progress, active sessions, and recent activity",
        inputSchema: {
          type: "object",
          properties: {
            verbose: {
              type: "boolean",
              description: "Include detailed information"
            }
          },
          required: []
        }
      }
    ];
    SSOT_FILES = [
      ".claude/memory/decisions.md",
      ".claude/memory/patterns.md",
      "AGENTS.md",
      "CLAUDE.md"
    ];
  }
});

// src/tools/code-intelligence.ts
import { execFile } from "child_process";
import { promisify as promisify2 } from "util";
import * as path4 from "path";
import * as fs5 from "fs";
function isValidAstSearchArgs(args) {
  return typeof args === "object" && args !== null && "pattern" in args && typeof args.pattern === "string" && "language" in args && typeof args.language === "string";
}
function isValidLspPositionArgs(args) {
  return typeof args === "object" && args !== null && "file" in args && typeof args.file === "string" && "line" in args && typeof args.line === "number" && "column" in args && typeof args.column === "number";
}
function isValidLspFileArgs(args) {
  return typeof args === "object" && args !== null && "file" in args && typeof args.file === "string";
}
async function checkCommand(cmd) {
  try {
    await execFileAsync("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}
async function validatePath(searchPath, projectRoot) {
  const fullPath = path4.resolve(projectRoot, searchPath);
  const normalizedRoot = projectRoot.endsWith(path4.sep) ? projectRoot : projectRoot + path4.sep;
  if (fullPath !== projectRoot && !fullPath.startsWith(normalizedRoot)) {
    return {
      valid: false,
      fullPath: "",
      error: `Path must be within project root. Got: ${searchPath}`
    };
  }
  const relativePath = path4.relative(projectRoot, fullPath);
  if (relativePath.startsWith("..") || path4.isAbsolute(relativePath)) {
    return {
      valid: false,
      fullPath: "",
      error: `Path escapes project root. Got: ${searchPath}`
    };
  }
  try {
    if (fs5.existsSync(fullPath)) {
      const realFullPath = await realpathAsync(fullPath);
      const realProjectRoot = await realpathAsync(projectRoot);
      const normalizedRealRoot = realProjectRoot.endsWith(path4.sep) ? realProjectRoot : realProjectRoot + path4.sep;
      if (realFullPath !== realProjectRoot && !realFullPath.startsWith(normalizedRealRoot)) {
        return {
          valid: false,
          fullPath: "",
          error: `Path resolves outside project root (symlink detected). Got: ${searchPath}`
        };
      }
    }
  } catch {
  }
  return { valid: true, fullPath };
}
async function handleAstSearch(args) {
  const { pattern, language, path: searchPath = "." } = args;
  if (!ALLOWED_LANGUAGES.includes(language)) {
    return {
      content: [
        {
          type: "text",
          text: `\u274C Invalid language: ${language}. Allowed: ${ALLOWED_LANGUAGES.join(", ")}`
        }
      ],
      isError: true
    };
  }
  const installed = await checkCommand("sg");
  if (!installed) {
    return {
      content: [
        {
          type: "text",
          text: `\u274C ast-grep not installed.

**To install:**
- macOS: \`brew install ast-grep\`
- npm: \`npm install -g @ast-grep/cli\`
- cargo: \`cargo install ast-grep --locked\`

Or run \`/dev-tools-setup\` to install all development tools.

**Fallback:** Use the Grep tool for basic text pattern search.`
        }
      ],
      isError: true
    };
  }
  try {
    const projectRoot = getProjectRoot();
    const pathValidation = await validatePath(searchPath, projectRoot);
    if (!pathValidation.valid) {
      return {
        content: [{ type: "text", text: `\u274C ${pathValidation.error}` }],
        isError: true
      };
    }
    const { stdout, stderr } = await execFileAsync(
      "sg",
      ["--pattern", pattern, "--lang", language, "--json", pathValidation.fullPath],
      { maxBuffer: 10 * 1024 * 1024 }
      // 10MB buffer
    );
    if (stderr && !stdout) {
      return {
        content: [{ type: "text", text: `\u26A0\uFE0F ast-grep warning: ${stderr}` }]
      };
    }
    let results;
    try {
      results = JSON.parse(stdout || "[]");
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `\u{1F50D} AST Search Results for \`${pattern}\` (${language})

No matches found.`
          }
        ]
      };
    }
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `\u{1F50D} AST Search Results for \`${pattern}\` (${language})

No matches found.`
          }
        ]
      };
    }
    const formattedResults = results.slice(0, 50).map((r) => {
      const relativePath = r.file.replace(projectRoot + "/", "");
      return `- **${relativePath}:${r.range.start.line}:${r.range.start.column}**
  \`${r.text.trim().substring(0, 100)}${r.text.length > 100 ? "..." : ""}\``;
    }).join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `\u{1F50D} **AST Search Results** for \`${pattern}\` (${language})

**Matches: ${results.length}**${results.length > 50 ? " (showing first 50)" : ""}

${formattedResults}`
        }
      ]
    };
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return {
      content: [{ type: "text", text: `\u274C AST search error: ${message}` }],
      isError: true
    };
  }
}
async function handleLspReferences(args) {
  const { file, line, column } = args;
  return {
    content: [
      {
        type: "text",
        text: `\u{1F50D} **Find References** for ${file}:${line}:${column}

To find references, use one of these methods:

**1. Claude Code native (recommended):**
\`\`\`
Use the LSP tool: lsp_references
File: ${file}
Position: line ${line}, column ${column}
\`\`\`

**2. TypeScript/JavaScript:**
\`\`\`bash
npx ts-node -e "
const ts = require('typescript');
// Use TS Language Service API
"
\`\`\`

**3. IDE integration:**
- VSCode: F12 or right-click \u2192 "Find All References"
- Cursor: Same as VSCode

**Fallback:** Use Grep to search for the symbol name:
\`\`\`bash
grep -rn "symbolName" --include="*.ts" --include="*.tsx"
\`\`\`

\u{1F4A1} Run \`/dev-tools-setup\` to configure LSP integration.`
      }
    ]
  };
}
async function handleLspDefinition(args) {
  const { file, line, column } = args;
  return {
    content: [
      {
        type: "text",
        text: `\u{1F3AF} **Go to Definition** for ${file}:${line}:${column}

To find the definition, use one of these methods:

**1. Claude Code native (recommended):**
\`\`\`
Use the LSP tool: lsp_definition
File: ${file}
Position: line ${line}, column ${column}
\`\`\`

**2. Read the file directly:**
The AI can read the import statements and navigate to the source file.

**3. IDE integration:**
- VSCode/Cursor: Cmd+Click on the symbol

\u{1F4A1} Run \`/dev-tools-setup\` to configure LSP integration.`
      }
    ]
  };
}
async function handleLspDiagnostics(args) {
  const { file } = args;
  const projectRoot = getProjectRoot();
  const pathValidation = await validatePath(file, projectRoot);
  if (!pathValidation.valid) {
    return {
      content: [{ type: "text", text: `\u274C ${pathValidation.error}` }]
    };
  }
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["tsc", "--noEmit", "--pretty", "false"],
        { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 }
      );
      const relativePath = path4.relative(projectRoot, pathValidation.fullPath);
      const lines = stdout.split("\n");
      const diagnostics = lines.filter((line) => line.startsWith(relativePath)).join("\n").trim();
      if (!diagnostics) {
        return {
          content: [
            {
              type: "text",
              text: `\u2705 **Diagnostics for ${file}**

No TypeScript errors found.`
            }
          ]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `\u{1F4CA} **Diagnostics for ${file}**

\`\`\`
${diagnostics}
\`\`\``
          }
        ]
      };
    } catch {
    }
  }
  return {
    content: [
      {
        type: "text",
        text: `\u{1F4CA} **Get Diagnostics** for ${file}

To get diagnostics, use one of these methods:

**1. TypeScript/JavaScript:**
\`\`\`bash
npx tsc --noEmit
\`\`\`

**2. ESLint:**
\`\`\`bash
npx eslint ${file}
\`\`\`

**3. Python:**
\`\`\`bash
mypy ${file}
# or
ruff check ${file}
\`\`\`

**4. IDE integration:**
- Errors appear in the Problems panel

\u{1F4A1} Run \`/dev-tools-setup\` to configure LSP integration.`
      }
    ]
  };
}
async function handleLspHover(args) {
  const { file, line, column } = args;
  return {
    content: [
      {
        type: "text",
        text: `\u{1F4DD} **Hover Info** for ${file}:${line}:${column}

To get type information, the AI can:

**1. Read the file and infer types:**
The AI can analyze the code context to determine types.

**2. Check type definitions:**
Look for \`.d.ts\` files or TypeScript declarations.

**3. IDE integration:**
- VSCode/Cursor: Hover over the symbol

\u{1F4A1} Run \`/dev-tools-setup\` to configure LSP integration.`
      }
    ]
  };
}
async function handleCodeIntelligenceTool(name, args) {
  switch (name) {
    case "harness_ast_search":
      if (!isValidAstSearchArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Invalid arguments for ast_search. Required: pattern (string), language (string)"
            }
          ],
          isError: true
        };
      }
      return handleAstSearch(args);
    case "harness_lsp_references":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Invalid arguments for lsp_references. Required: file (string), line (number), column (number)"
            }
          ],
          isError: true
        };
      }
      return handleLspReferences(args);
    case "harness_lsp_definition":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Invalid arguments for lsp_definition. Required: file (string), line (number), column (number)"
            }
          ],
          isError: true
        };
      }
      return handleLspDefinition(args);
    case "harness_lsp_diagnostics":
      if (!isValidLspFileArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Invalid arguments for lsp_diagnostics. Required: file (string)"
            }
          ],
          isError: true
        };
      }
      return handleLspDiagnostics(args);
    case "harness_lsp_hover":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Invalid arguments for lsp_hover. Required: file (string), line (number), column (number)"
            }
          ],
          isError: true
        };
      }
      return handleLspHover(args);
    default:
      return {
        content: [
          { type: "text", text: `Unknown code intelligence tool: ${name}` }
        ],
        isError: true
      };
  }
}
var execFileAsync, realpathAsync, ALLOWED_LANGUAGES, codeIntelligenceTools;
var init_code_intelligence = __esm({
  "src/tools/code-intelligence.ts"() {
    "use strict";
    init_utils();
    execFileAsync = promisify2(execFile);
    realpathAsync = promisify2(fs5.realpath);
    ALLOWED_LANGUAGES = [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "java",
      "c",
      "cpp"
    ];
    codeIntelligenceTools = [
      // AST-Grep Tool
      {
        name: "harness_ast_search",
        description: "Search code by structural patterns using AST-Grep. Use for: finding code smells, pattern matching, structural refactoring. Examples: 'console.log($$$)', 'if ($COND) { return $X }', 'async function $NAME($$$) { $$$ }'",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern using ast-grep syntax. Use $ for single node, $$$ for multiple nodes."
            },
            language: {
              type: "string",
              enum: [...ALLOWED_LANGUAGES],
              description: "Target language"
            },
            path: {
              type: "string",
              description: "Search path (default: current directory)"
            }
          },
          required: ["pattern", "language"]
        }
      },
      // LSP Tools
      {
        name: "harness_lsp_references",
        description: "Find all references to a symbol across the codebase. Use for: impact analysis before refactoring, understanding usage patterns.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path containing the symbol"
            },
            line: {
              type: "number",
              description: "Line number (1-indexed)"
            },
            column: {
              type: "number",
              description: "Column number (1-indexed)"
            }
          },
          required: ["file", "line", "column"]
        }
      },
      {
        name: "harness_lsp_definition",
        description: "Go to the definition of a symbol. Use for: understanding implementation details, navigating to source.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path"
            },
            line: {
              type: "number",
              description: "Line number"
            },
            column: {
              type: "number",
              description: "Column number"
            }
          },
          required: ["file", "line", "column"]
        }
      },
      {
        name: "harness_lsp_diagnostics",
        description: "Get code diagnostics (errors, warnings, hints) for a file. Use for: pre-commit validation, error detection.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path to diagnose"
            }
          },
          required: ["file"]
        }
      },
      {
        name: "harness_lsp_hover",
        description: "Get type information and documentation for a symbol. Use for: understanding types, checking signatures.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path"
            },
            line: {
              type: "number",
              description: "Line number"
            },
            column: {
              type: "number",
              description: "Column number"
            }
          },
          required: ["file", "line", "column"]
        }
      }
    ];
  }
});

// src/pii/pii-filter.ts
import { readFileSync as readFileSync5 } from "node:fs";
function applyPiiFilter(text, rules) {
  let result = text;
  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, "g");
      result = result.replace(regex, rule.replacement);
    } catch {
    }
  }
  return result;
}
function loadPiiRules(rulesPath) {
  try {
    const raw = readFileSync5(rulesPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.rules)) {
      return parsed.rules.filter(
        (r) => typeof r.name === "string" && typeof r.pattern === "string" && typeof r.replacement === "string"
      );
    }
  } catch {
  }
  return [];
}
function getActivePiiRules() {
  const enabled = (process.env.HARNESS_MEM_PII_FILTER || "").toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    return null;
  }
  const rulesPath = process.env.HARNESS_MEM_PII_RULES_PATH;
  if (rulesPath) {
    const custom2 = loadPiiRules(rulesPath);
    return custom2.length > 0 ? custom2 : DEFAULT_PII_RULES;
  }
  return DEFAULT_PII_RULES;
}
var DEFAULT_PII_RULES;
var init_pii_filter = __esm({
  "src/pii/pii-filter.ts"() {
    "use strict";
    DEFAULT_PII_RULES = [
      {
        name: "phone",
        pattern: "0\\d{1,4}[-\u2010\u2212]?\\d{1,4}[-\u2010\u2212]?\\d{3,4}",
        replacement: "[PHONE]"
      },
      {
        name: "email",
        pattern: "[\\w.+\\-]+@[\\w.\\-]+\\.\\w+",
        replacement: "[EMAIL]"
      },
      {
        name: "line_id",
        pattern: "@[a-zA-Z0-9_.]{3,20}",
        replacement: "[LINE_ID]"
      }
    ];
  }
});

// src/tool-result.ts
function createJsonToolResult(data, options = {}) {
  const text = options.text ?? (typeof data === "string" ? data : JSON.stringify(data, null, 2));
  const result = {
    content: [{ type: "text", text }],
    structuredContent: data,
    _meta: {
      "anthropic/maxResultSizeChars": options.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS
    }
  };
  if (options.isError) {
    result.isError = true;
  }
  if (options.citations !== void 0) {
    result._citations = options.citations;
  }
  return result;
}
var DEFAULT_MAX_RESULT_SIZE_CHARS;
var init_tool_result = __esm({
  "src/tool-result.ts"() {
    "use strict";
    DEFAULT_MAX_RESULT_SIZE_CHARS = 5e5;
  }
});

// src/tools/memory.ts
import * as fs6 from "fs";
import * as path5 from "path";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify3 } from "util";
function isRemoteMode() {
  return !!(process.env.HARNESS_MEM_REMOTE_URL || "").trim();
}
function getBaseUrl() {
  const remoteUrl = (process.env.HARNESS_MEM_REMOTE_URL || "").trim();
  if (remoteUrl) {
    return remoteUrl.replace(/\/$/, "");
  }
  const host = process.env.HARNESS_MEM_HOST || "127.0.0.1";
  const port = process.env.HARNESS_MEM_PORT || "37888";
  return `http://${host}:${port}`;
}
async function tryHealthCheck(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
function isWithinPath(root, target) {
  const relative3 = path5.relative(root, target);
  return relative3 === "" || !relative3.startsWith("..") && !path5.isAbsolute(relative3);
}
function validateImportSourcePath(sourceDbPath) {
  const trimmed = sourceDbPath.trim();
  if (!trimmed) {
    return { ok: false, reason: "source_db_path is required" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, reason: "source_db_path contains invalid characters" };
  }
  const resolvedPath = path5.resolve(trimmed);
  const ext = path5.extname(resolvedPath).toLowerCase();
  if (![".db", ".sqlite", ".sqlite3"].includes(ext)) {
    return { ok: false, reason: "source_db_path must use .db/.sqlite/.sqlite3 extension" };
  }
  const homeDir = process.env.HOME ? path5.resolve(process.env.HOME) : "";
  const projectRoot = path5.resolve(getProjectRoot());
  const allowed = homeDir && isWithinPath(homeDir, resolvedPath) || isWithinPath(projectRoot, resolvedPath);
  if (!allowed) {
    return { ok: false, reason: "source_db_path must be under HOME or project root" };
  }
  if (!fs6.existsSync(resolvedPath)) {
    return { ok: false, reason: `source_db_path not found: ${resolvedPath}` };
  }
  return { ok: true, resolvedPath };
}
async function tryStartDaemon() {
  const projectRoot = getProjectRoot();
  const scriptPath = path5.join(projectRoot, "scripts", "harness-memd");
  if (!fs6.existsSync(scriptPath)) {
    return;
  }
  try {
    const resolvedProjectRoot = fs6.realpathSync(projectRoot);
    const resolvedScriptPath = fs6.realpathSync(scriptPath);
    if (!isWithinPath(resolvedProjectRoot, resolvedScriptPath)) {
      return;
    }
    await execFileAsync2(resolvedScriptPath, ["start", "--quiet"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HARNESS_MEM_CODEX_PROJECT_ROOT: process.env.HARNESS_MEM_CODEX_PROJECT_ROOT || projectRoot
      }
    });
  } catch {
  }
}
async function ensureDaemon(baseUrl) {
  if (Date.now() - lastHealthyAt < HEALTH_CACHE_MS) {
    return;
  }
  if (isRemoteMode()) {
    const healthy2 = await tryHealthCheck(baseUrl);
    if (healthy2) {
      lastHealthyAt = Date.now();
      return;
    }
    throw new Error(`\u30EA\u30E2\u30FC\u30C8 memory server (${baseUrl}) \u3078\u306E\u30D8\u30EB\u30B9\u30C1\u30A7\u30C3\u30AF\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002VPS \u304C\u8D77\u52D5\u3057\u3066\u3044\u308B\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
  }
  const healthy = await tryHealthCheck(baseUrl);
  if (healthy) {
    lastHealthyAt = Date.now();
    return;
  }
  await tryStartDaemon();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const started = await tryHealthCheck(baseUrl);
    if (started) {
      lastHealthyAt = Date.now();
      return;
    }
    await new Promise((resolve3) => setTimeout(resolve3, 150));
  }
  throw new Error("harness-memd health check failed after 10 retries");
}
function buildApiHeaders() {
  const headers = {
    "content-type": "application/json"
  };
  const remoteToken = isRemoteMode() ? (process.env.HARNESS_MEM_REMOTE_TOKEN || "").trim() : "";
  const localToken = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  const token = remoteToken || localToken;
  if (token) {
    headers["x-harness-mem-token"] = token;
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
async function callMemoryApi(endpoint, payload, method = "POST") {
  const baseUrl = getBaseUrl();
  await ensureDaemon(baseUrl);
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: buildApiHeaders(),
    body: method === "POST" ? JSON.stringify(payload ?? {}) : void 0
  });
  const clone2 = response.clone();
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    const text = await clone2.text();
    throw new Error(`Unexpected response from memory server: ${text.slice(0, 200)}`);
  }
  if (!parsed || !response.ok || parsed.ok === false) {
    const message = parsed?.error || `memory server returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed;
}
function successResult(payload, options) {
  const citations = options?.citations && payload.items?.length ? payload.items.map((item) => ({
    id: item.id ?? null,
    source: item.platform ?? item.source ?? "harness-mem",
    session_id: item.session_id ?? null,
    timestamp: item.created_at ?? item.timestamp ?? null,
    type: item.type ?? item.event_type ?? "observation"
  })) : void 0;
  return createJsonToolResult(payload, { citations });
}
function errorResult(message) {
  return createJsonToolResult(
    {
      ok: false,
      error: message
    },
    {
      isError: true,
      text: message
    }
  );
}
function toObject(args) {
  if (!args || typeof args !== "object") {
    return {};
  }
  return args;
}
function toStringOrUndefined(value) {
  return typeof value === "string" ? value : void 0;
}
function toNumberOrUndefined(value) {
  return typeof value === "number" ? value : void 0;
}
function toBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}
function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string");
}
function getMcpPlatform() {
  return (process.env.HARNESS_MEM_MCP_PLATFORM || "").trim() || void 0;
}
function recordToolUseEvent(toolName, phase, platform, extra) {
  const baseUrl = getBaseUrl();
  try {
    fetch(`${baseUrl}/v1/events/record`, {
      method: "POST",
      headers: buildApiHeaders(),
      body: JSON.stringify({
        event: {
          platform,
          project: process.env.HARNESS_MEM_OPENCODE_PROJECT_ROOT || process.cwd(),
          session_id: `mcp-${platform}-${process.pid}`,
          event_type: "tool_use",
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          payload: {
            tool_name: toolName,
            phase,
            source: "mcp_server_hook_supplement",
            ...extra
          },
          tags: [`${platform}_mcp_tool_use`, `tool.execute.${phase}`]
        }
      })
    }).catch(() => {
    });
  } catch {
  }
}
async function handleMemoryTool(name, args) {
  const platform = getMcpPlatform();
  const shouldTrack = !!platform && !SELF_TRACK_SKIP.has(name);
  const startMs = Date.now();
  if (shouldTrack) {
    recordToolUseEvent(name, "before", platform);
  }
  const result = await handleMemoryToolInner(name, args);
  if (shouldTrack) {
    const durationMs = Date.now() - startMs;
    recordToolUseEvent(name, "after", platform, {
      success: !result.isError,
      duration_ms: durationMs
    });
  }
  return result;
}
async function runConsolidation(input) {
  const response = await callMemoryApi("/v1/admin/consolidation/run", {
    reason: toStringOrUndefined(input.reason),
    project: toStringOrUndefined(input.project),
    session_id: toStringOrUndefined(input.session_id),
    limit: toNumberOrUndefined(input.limit)
  });
  return successResult(response);
}
async function handleMemoryToolInner(name, args) {
  const input = toObject(args);
  try {
    switch (name) {
      case "harness_mem_resume_pack": {
        const project = toStringOrUndefined(input.project);
        if (!project) {
          return errorResult("project is required");
        }
        const response = await callMemoryApi("/v1/resume-pack", {
          project,
          session_id: toStringOrUndefined(input.session_id),
          correlation_id: toStringOrUndefined(input.correlation_id),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false)
        });
        return successResult(response);
      }
      case "harness_mem_search": {
        const query = toStringOrUndefined(input.query);
        if (!query) {
          return errorResult("query is required");
        }
        const sortBy = toStringOrUndefined(input.sort_by);
        const validSortValues = ["relevance", "date_desc", "date_asc"];
        const response = await callMemoryApi("/v1/search", {
          query,
          project: toStringOrUndefined(input.project),
          session_id: toStringOrUndefined(input.session_id),
          since: toStringOrUndefined(input.since),
          until: toStringOrUndefined(input.until),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false),
          sort_by: sortBy && validSortValues.includes(sortBy) ? sortBy : void 0
        });
        const result = successResult(response, { citations: true });
        if (response.meta?.count > 0) {
          Promise.resolve().then(() => (init_index(), index_exports)).then((m) => m.pushMemoryNotification(`Memory search: ${response.meta.count} results for "${query}"`)).catch(() => {
          });
        }
        return result;
      }
      case "harness_mem_sessions_list": {
        const query = new URLSearchParams();
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/sessions/list?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_session_thread": {
        const sessionId = toStringOrUndefined(input.session_id);
        if (!sessionId) {
          return errorResult("session_id is required");
        }
        const query = new URLSearchParams();
        query.set("session_id", sessionId);
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/sessions/thread?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_search_facets": {
        const query = new URLSearchParams();
        const rawQuery = toStringOrUndefined(input.query);
        if (rawQuery) query.set("query", rawQuery);
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/search/facets?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_timeline": {
        const id = toStringOrUndefined(input.id);
        if (!id) {
          return errorResult("id is required");
        }
        const response = await callMemoryApi("/v1/timeline", {
          id,
          before: toNumberOrUndefined(input.before),
          after: toNumberOrUndefined(input.after),
          include_private: toBoolean(input.include_private, false)
        });
        return successResult(response);
      }
      case "harness_mem_get_observations": {
        const ids = toStringArray(input.ids);
        if (ids.length === 0) {
          return errorResult("ids is required");
        }
        const response = await callMemoryApi("/v1/observations/get", {
          ids,
          include_private: toBoolean(input.include_private, false),
          compact: toBoolean(input.compact, true)
        });
        return successResult(response);
      }
      case "harness_mem_record_checkpoint": {
        const sessionId = toStringOrUndefined(input.session_id);
        const title = toStringOrUndefined(input.title);
        const rawContent = toStringOrUndefined(input.content);
        if (!sessionId || !title || !rawContent) {
          return errorResult("session_id, title, content are required");
        }
        const piiRules = getActivePiiRules();
        const content = piiRules ? applyPiiFilter(rawContent, piiRules) : rawContent;
        const response = await callMemoryApi("/v1/checkpoints/record", {
          platform: toStringOrUndefined(input.platform),
          project: toStringOrUndefined(input.project),
          session_id: sessionId,
          title,
          content,
          tags: toStringArray(input.tags),
          privacy_tags: toStringArray(input.privacy_tags)
        });
        return successResult(response);
      }
      case "harness_mem_finalize_session": {
        const sessionId = toStringOrUndefined(input.session_id);
        if (!sessionId) {
          return errorResult("session_id is required");
        }
        const response = await callMemoryApi("/v1/sessions/finalize", {
          platform: toStringOrUndefined(input.platform),
          project: toStringOrUndefined(input.project),
          session_id: sessionId,
          correlation_id: toStringOrUndefined(input.correlation_id),
          summary_mode: toStringOrUndefined(input.summary_mode)
        });
        return successResult(response);
      }
      case "harness_mem_record_event": {
        const event = toObject(input.event);
        if (Object.keys(event).length === 0) {
          return errorResult("event is required");
        }
        const response = await callMemoryApi("/v1/events/record", {
          event
        });
        return successResult(response);
      }
      case "harness_mem_health": {
        const response = await callMemoryApi("/health", null, "GET");
        return successResult(response);
      }
      case "harness_mem_delete_observation": {
        const observationId = toStringOrUndefined(input.observation_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        const response = await callMemoryApi(`/v1/observations/${encodeURIComponent(observationId)}`, null, "DELETE");
        return successResult(response);
      }
      case "harness_mem_admin_reindex_vectors": {
        const response = await callMemoryApi("/v1/admin/reindex-vectors", {
          limit: toNumberOrUndefined(input.limit)
        });
        return successResult(response);
      }
      case "harness_mem_admin_import_claude_mem": {
        const sourceDbPath = toStringOrUndefined(input.source_db_path);
        if (!sourceDbPath) {
          return errorResult("source_db_path is required");
        }
        const validated = validateImportSourcePath(sourceDbPath);
        if (!validated.ok) {
          return errorResult(validated.reason);
        }
        const response = await callMemoryApi("/v1/admin/imports/claude-mem", {
          source_db_path: validated.resolvedPath,
          project: toStringOrUndefined(input.project),
          dry_run: toBoolean(input.dry_run, false)
        });
        return successResult(response);
      }
      case "harness_mem_admin_import_status": {
        const jobId = toStringOrUndefined(input.job_id);
        if (!jobId) {
          return errorResult("job_id is required");
        }
        const response = await callMemoryApi(`/v1/admin/imports/${encodeURIComponent(jobId)}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_admin_verify_import": {
        const jobId = toStringOrUndefined(input.job_id);
        if (!jobId) {
          return errorResult("job_id is required");
        }
        const response = await callMemoryApi(`/v1/admin/imports/${encodeURIComponent(jobId)}/verify`, {});
        return successResult(response);
      }
      case "harness_mem_admin_metrics": {
        const response = await callMemoryApi("/v1/admin/metrics", null, "GET");
        return successResult(response);
      }
      case "harness_mem_admin_consolidation_run": {
        return runConsolidation(input);
      }
      case "harness_mem_admin_consolidation_status": {
        const response = await callMemoryApi("/v1/admin/consolidation/status", null, "GET");
        return successResult(response);
      }
      case "harness_mem_admin_audit_log": {
        const query = new URLSearchParams();
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        const action = toStringOrUndefined(input.action);
        if (action) query.set("action", action);
        const targetType = toStringOrUndefined(input.target_type);
        if (targetType) query.set("target_type", targetType);
        const response = await callMemoryApi(`/v1/admin/audit-log?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_add_relation": {
        const fromId = toStringOrUndefined(input.from_observation_id);
        const toId = toStringOrUndefined(input.to_observation_id);
        const relation = toStringOrUndefined(input.relation);
        if (!fromId || !toId || !relation) {
          return errorResult("from_observation_id, to_observation_id, relation are required");
        }
        const response = await callMemoryApi("/v1/links/create", {
          from_observation_id: fromId,
          to_observation_id: toId,
          relation,
          weight: toNumberOrUndefined(input.weight)
        });
        return successResult(response);
      }
      case "harness_mem_bulk_add": {
        const events = Array.isArray(input.events) ? input.events : [];
        if (events.length === 0) {
          return errorResult("events is required and must not be empty");
        }
        const results = await Promise.all(
          events.map((event) => callMemoryApi("/v1/events/record", { event }))
        );
        const combinedResponse = {
          ok: true,
          source: "core",
          items: results,
          meta: { count: results.length, latency_ms: 0, filters: {}, ranking: "bulk_add_v1" }
        };
        return successResult(combinedResponse);
      }
      case "harness_mem_bulk_delete": {
        const ids = toStringArray(input.ids);
        if (ids.length === 0) {
          return errorResult("ids is required and must not be empty");
        }
        const response = await callMemoryApi("/v1/observations/bulk-delete", { ids });
        return successResult(response);
      }
      case "harness_mem_export": {
        const query = new URLSearchParams();
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/export?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_compress": {
        return runConsolidation(input);
      }
      case "harness_mem_stats": {
        const query = new URLSearchParams();
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/projects/stats?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_ingest": {
        const filePath = toStringOrUndefined(input.file_path);
        const content = toStringOrUndefined(input.content);
        if (!filePath || !content) {
          return errorResult("file_path and content are required");
        }
        const response = await callMemoryApi("/v1/ingest/document", {
          file_path: filePath,
          content,
          kind: toStringOrUndefined(input.kind),
          project: toStringOrUndefined(input.project),
          platform: toStringOrUndefined(input.platform),
          session_id: toStringOrUndefined(input.session_id)
        });
        return successResult(response);
      }
      case "harness_mem_graph": {
        const observationId = toStringOrUndefined(input.observation_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        const query = new URLSearchParams();
        query.set("observation_id", observationId);
        const relation = toStringOrUndefined(input.relation);
        if (relation) query.set("relation", relation);
        const depth = toNumberOrUndefined(input.depth);
        if (depth !== void 0) query.set("depth", String(Math.min(Math.max(depth, 1), 5)));
        const response = await callMemoryApi(`/v1/graph/neighbors?${query.toString()}`, null, "GET");
        return successResult(response);
      }
      case "harness_mem_share_to_team": {
        const observationId = toStringOrUndefined(input.observation_id);
        const teamId = toStringOrUndefined(input.team_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        if (!teamId) {
          return errorResult("team_id is required");
        }
        const response = await callMemoryApi("/v1/observations/share", {
          observation_id: observationId,
          team_id: teamId
        });
        return successResult(response);
      }
      default:
        return errorResult(`Unknown memory tool: ${name}`);
    }
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    const kind = /ECONNREFUSED|health check failed|failed/i.test(message) ? "daemon_unavailable" : /timeout|timed out/i.test(message) ? "timeout" : "request_failed";
    return errorResult(`Memory tool failed [${kind}]: ${message}`);
  }
}
var execFileAsync2, HEALTH_CACHE_MS, lastHealthyAt, memoryTools, SELF_TRACK_SKIP;
var init_memory = __esm({
  "src/tools/memory.ts"() {
    "use strict";
    init_utils();
    init_pii_filter();
    init_tool_result();
    execFileAsync2 = promisify3(execFile2);
    HEALTH_CACHE_MS = 5e3;
    lastHealthyAt = 0;
    memoryTools = [
      {
        name: "harness_mem_resume_pack",
        description: "Get cross-platform resume context pack for a project/session. Supports correlation_id to fetch context across all related sessions.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            session_id: { type: "string" },
            correlation_id: { type: "string" },
            limit: { type: "number" },
            include_private: { type: "boolean" }
          },
          required: ["project"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_search",
        description: "Step 1 of 3-layer workflow (search -> timeline -> get_observations). Returns candidate IDs with meta.token_estimate.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            since: { type: "string" },
            until: { type: "string" },
            limit: { type: "number" },
            include_private: { type: "boolean" },
            sort_by: { type: "string", enum: ["relevance", "date_desc", "date_asc"], description: "Sort order: relevance (default), date_desc (newest first), date_asc (oldest first)" }
          },
          required: ["query"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_timeline",
        description: "Step 2 of 3-layer workflow. Expands one observation into before/after context with meta.token_estimate.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            before: { type: "number" },
            after: { type: "number" },
            include_private: { type: "boolean" }
          },
          required: ["id"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_get_observations",
        description: "Step 3 of 3-layer workflow. Fetch full details only for filtered IDs. Returns meta.token_estimate and warnings for large batches.",
        inputSchema: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" } },
            include_private: { type: "boolean" },
            compact: { type: "boolean" }
          },
          required: ["ids"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_sessions_list",
        description: "List sessions with summary/count metadata for a project.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            limit: { type: "number" },
            include_private: { type: "boolean" }
          },
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_session_thread",
        description: "Get ordered thread events for a session.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            project: { type: "string" },
            limit: { type: "number" },
            include_private: { type: "boolean" }
          },
          required: ["session_id"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_search_facets",
        description: "Get project/type/tag/time facets for a query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            project: { type: "string" },
            include_private: { type: "boolean" }
          },
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_record_checkpoint",
        description: "Record a checkpoint observation for a session.",
        inputSchema: {
          type: "object",
          properties: {
            platform: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            privacy_tags: { type: "array", items: { type: "string" } }
          },
          required: ["session_id", "title", "content"]
        },
        annotations: { idempotentHint: true }
      },
      {
        name: "harness_mem_finalize_session",
        description: "Finalize session and generate summary.",
        inputSchema: {
          type: "object",
          properties: {
            platform: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            correlation_id: { type: "string" },
            summary_mode: {
              type: "string",
              enum: ["standard", "short", "detailed"]
            }
          },
          required: ["session_id"]
        },
        annotations: { readOnlyHint: false }
      },
      {
        name: "harness_mem_record_event",
        description: "Record normalized event envelope (adapter-internal use).",
        inputSchema: {
          type: "object",
          properties: {
            event: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                platform: { type: "string" },
                project: { type: "string" },
                session_id: { type: "string" },
                event_type: { type: "string" },
                ts: { type: "string" },
                payload: { type: "object" },
                tags: { type: "array", items: { type: "string" } },
                privacy_tags: { type: "array", items: { type: "string" } },
                dedupe_hash: { type: "string" },
                correlation_id: { type: "string" }
              },
              required: ["platform", "project", "session_id", "event_type"]
            }
          },
          required: ["event"]
        },
        annotations: { idempotentHint: true }
      },
      {
        name: "harness_mem_health",
        description: "Get unified harness memory daemon health.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_delete_observation",
        description: "Soft-delete (archive) a specific observation by ID. The observation is marked as deleted and excluded from search results.",
        inputSchema: {
          type: "object",
          properties: {
            observation_id: {
              type: "string",
              description: "The ID of the observation to delete"
            }
          },
          required: ["observation_id"]
        },
        annotations: { destructiveHint: true }
      },
      {
        name: "harness_mem_admin_import_claude_mem",
        description: "Run one-shot import from Claude-mem SQLite.",
        inputSchema: {
          type: "object",
          properties: {
            source_db_path: { type: "string" },
            project: { type: "string" },
            dry_run: { type: "boolean" }
          },
          required: ["source_db_path"]
        },
        annotations: { readOnlyHint: false }
      },
      {
        name: "harness_mem_admin_import_status",
        description: "Get status/result for an import job.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" }
          },
          required: ["job_id"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_admin_verify_import",
        description: "Verify import job integrity/privacy checks.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" }
          },
          required: ["job_id"]
        },
        annotations: { readOnlyHint: false }
      },
      {
        name: "harness_mem_admin_reindex_vectors",
        description: "Rebuild vector index from stored observations.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number" }
          },
          required: []
        },
        annotations: { idempotentHint: true, readOnlyHint: false }
      },
      {
        name: "harness_mem_admin_metrics",
        description: "Get memory metrics and vector/fts coverage.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_admin_consolidation_run",
        description: "Run consolidation worker (extract + dedupe) immediately.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            limit: { type: "number" }
          },
          required: []
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      {
        name: "harness_mem_admin_consolidation_status",
        description: "Get consolidation queue/facts status.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_admin_audit_log",
        description: "Get audit log entries for retrieval/admin actions.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number" },
            action: { type: "string" },
            target_type: { type: "string" }
          },
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_add_relation",
        description: "Add a directed relation (link) between two observations.",
        inputSchema: {
          type: "object",
          properties: {
            from_observation_id: { type: "string", description: "Source observation ID" },
            to_observation_id: { type: "string", description: "Target observation ID" },
            relation: { type: "string", enum: ["updates", "extends", "derives", "follows", "shared_entity"], description: "Relation type" },
            weight: { type: "number", description: "Link weight (default: 1.0)" }
          },
          required: ["from_observation_id", "to_observation_id", "relation"]
        },
        annotations: { readOnlyHint: false }
      },
      {
        name: "harness_mem_bulk_add",
        description: "Record multiple observations in a single batch operation.",
        inputSchema: {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  platform: { type: "string" },
                  project: { type: "string" },
                  session_id: { type: "string" },
                  event_type: { type: "string" },
                  title: { type: "string" },
                  content: { type: "string" },
                  tags: { type: "array", items: { type: "string" } }
                },
                required: ["platform", "project", "session_id", "event_type"]
              },
              description: "Array of events to record"
            }
          },
          required: ["events"]
        },
        annotations: { readOnlyHint: false }
      },
      {
        name: "harness_mem_bulk_delete",
        description: "Soft-delete multiple observations by ID in a single batch operation.",
        inputSchema: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" }, description: "Array of observation IDs to delete" }
          },
          required: ["ids"]
        },
        annotations: { destructiveHint: true }
      },
      {
        name: "harness_mem_export",
        description: "Export observations as JSON for backup or analysis.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Filter by project (optional)" },
            limit: { type: "number", description: "Maximum number of observations to export (default: 1000)" },
            include_private: { type: "boolean", description: "Include deleted/private observations" }
          },
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_compress",
        description: "Run consolidation (compress/dedupe) worker immediately to extract facts and reduce redundancy.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            limit: { type: "number" }
          },
          required: []
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      {
        name: "harness_mem_stats",
        description: "Get per-project memory statistics including observation counts and session summaries.",
        inputSchema: {
          type: "object",
          properties: {
            include_private: { type: "boolean" }
          },
          required: []
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_ingest",
        description: "Ingest a document (knowledge file, ADR, decisions.md) into memory.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path identifier for the document" },
            content: { type: "string", description: "Text content of the document" },
            kind: { type: "string", enum: ["decisions_md", "adr"], description: "Document kind (auto-detected if omitted)" },
            project: { type: "string" },
            platform: { type: "string" },
            session_id: { type: "string" }
          },
          required: ["file_path", "content"]
        },
        annotations: { idempotentHint: true }
      },
      {
        name: "harness_mem_graph",
        description: "Explore graph neighbors of an observation (linked observations by relation). Supports BFS traversal up to depth 5.",
        inputSchema: {
          type: "object",
          properties: {
            observation_id: { type: "string", description: "Source observation ID to explore neighbors from" },
            relation: { type: "string", enum: ["updates", "extends", "derives", "follows", "shared_entity", "contradicts", "causes", "part_of"], description: "Filter by relation type" },
            depth: { type: "integer", minimum: 1, maximum: 5, default: 1, description: "BFS traversal depth (1-5, default 1)" }
          },
          required: ["observation_id"]
        },
        annotations: { readOnlyHint: true }
      },
      {
        name: "harness_mem_share_to_team",
        description: "Share a personal memory observation with your team. Sets team_id on the observation so team members can access it.",
        inputSchema: {
          type: "object",
          properties: {
            observation_id: { type: "string", description: "ID of the observation to share" },
            team_id: { type: "string", description: "Team ID to share with" }
          },
          required: ["observation_id", "team_id"]
        },
        annotations: { readOnlyHint: false, idempotentHint: true }
      }
    ];
    SELF_TRACK_SKIP = /* @__PURE__ */ new Set([
      "harness_mem_health",
      "harness_mem_record_event",
      "harness_mem_record_checkpoint",
      "harness_mem_finalize_session",
      "harness_mem_bulk_add"
    ]);
  }
});

// src/tools/context-box.ts
function getContextBoxUrl() {
  const url = (process.env.CONTEXT_BOX_URL || "").trim();
  if (!url) {
    throw new Error(
      'CONTEXT_BOX_URL is not set. Configure it in MCP server env (e.g. CONTEXT_BOX_URL="https://claude-harness.com" or "http://localhost:3100")'
    );
  }
  return url.replace(/\/$/, "");
}
function getApiToken() {
  return (process.env.CONTEXT_BOX_API_TOKEN || "").trim() || void 0;
}
function getDefaultWorkspaceId() {
  return (process.env.CONTEXT_BOX_WORKSPACE_ID || "").trim() || void 0;
}
function buildHeaders() {
  const headers = {
    "content-type": "application/json"
  };
  const token = getApiToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
async function cbHealthCheck(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3e3);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
async function ensureContextBox(baseUrl) {
  if (Date.now() - lastHealthyAt2 < HEALTH_CACHE_MS2) {
    return;
  }
  const healthy = await cbHealthCheck(baseUrl);
  if (healthy) {
    lastHealthyAt2 = Date.now();
    return;
  }
  throw new Error(
    `Context Box (${baseUrl}) is unreachable. Check that the VPS is running and CONTEXT_BOX_URL is correct.`
  );
}
async function callContextBoxApi(endpoint, payload, method = "POST") {
  const baseUrl = getContextBoxUrl();
  await ensureContextBox(baseUrl);
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: method === "POST" ? JSON.stringify(payload ?? {}) : void 0
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Context Box API returned HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }
  return await response.json();
}
function successResult2(data) {
  return createJsonToolResult(data);
}
function errorResult2(message) {
  return createJsonToolResult(
    {
      ok: false,
      error: message
    },
    {
      isError: true,
      text: message
    }
  );
}
function toStringOrUndefined2(value) {
  return typeof value === "string" ? value : void 0;
}
function toNumberOrUndefined2(value) {
  return typeof value === "number" ? value : void 0;
}
function toBooleanOrUndefined(value) {
  return typeof value === "boolean" ? value : void 0;
}
async function handleRecall(args) {
  const query = toStringOrUndefined2(args.query);
  if (!query) {
    return errorResult2("query is required");
  }
  const workspaceId = toStringOrUndefined2(args.workspace_id) || getDefaultWorkspaceId();
  const filters = {};
  const groupId = toStringOrUndefined2(args.group_id);
  if (groupId) filters.groupId = groupId;
  const sourceType = toStringOrUndefined2(args.source_type);
  if (sourceType) filters.sourceType = sourceType;
  const dateFrom = toStringOrUndefined2(args.date_from);
  if (dateFrom) filters.dateFrom = dateFrom;
  const dateTo = toStringOrUndefined2(args.date_to);
  if (dateTo) filters.dateTo = dateTo;
  const customer = toStringOrUndefined2(args.customer);
  if (customer) filters.customerId = customer;
  const author = toStringOrUndefined2(args.author);
  if (author) filters.author = author;
  const payload = {
    query,
    strategy: toStringOrUndefined2(args.strategy) || "hybrid",
    limit: toNumberOrUndefined2(args.limit) || 10
  };
  if (workspaceId) {
    payload.workspaceId = workspaceId;
  }
  if (Object.keys(filters).length > 0) {
    payload.filters = filters;
  }
  const response = await callContextBoxApi(
    "/context-bank/recall",
    payload
  );
  const summary = {
    query,
    strategy: payload.strategy,
    result_count: response.results?.length ?? 0,
    related_count: response.related?.length ?? 0,
    results: (response.results || []).map((r, i) => ({
      rank: i + 1,
      score: r.score,
      source_type: r.provenance?.sourceType,
      created_at: r.provenance?.createdAt,
      document_id: r.documentId,
      text: r.text
    })),
    related: (response.related || []).map((r) => ({
      document_id: r.documentId,
      excerpt: r.excerpt,
      score: r.score
    }))
  };
  return successResult2(summary);
}
async function handleSearch(args) {
  const query = toStringOrUndefined2(args.query);
  if (!query) {
    return errorResult2("query is required");
  }
  const workspaceId = toStringOrUndefined2(args.workspace_id) || getDefaultWorkspaceId();
  if (!workspaceId) {
    return errorResult2(
      "workspace_id is required (set CONTEXT_BOX_WORKSPACE_ID env or pass workspace_id parameter)"
    );
  }
  const payload = {
    query,
    workspaceId,
    strategy: toStringOrUndefined2(args.strategy) || "hybrid-lite",
    limit: toNumberOrUndefined2(args.limit) || 10
  };
  const response = await callContextBoxApi(
    "/api/search",
    payload
  );
  return successResult2({
    query: response.query,
    result_count: response.results?.length ?? 0,
    results: response.results || []
  });
}
async function handleTrace(args) {
  const documentId = toStringOrUndefined2(args.document_id);
  if (!documentId) {
    return errorResult2("document_id is required");
  }
  const response = await callContextBoxApi("/context-bank/trace", { documentId });
  return successResult2(response);
}
async function handleStatus2(args) {
  const detailed = toBooleanOrUndefined(args.detailed);
  const baseUrl = getContextBoxUrl();
  const endpoint = detailed ? "/health/detailed" : "/health";
  try {
    const response = await callContextBoxApi(
      endpoint,
      null,
      "GET"
    );
    return successResult2({
      status: "connected",
      url: baseUrl,
      ...response
    });
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return successResult2({
      status: "unreachable",
      url: baseUrl,
      error: message,
      hint: "Check CONTEXT_BOX_URL and ensure the VPS is running"
    });
  }
}
async function handleContextBoxTool(name, args) {
  const input = args ?? {};
  try {
    switch (name) {
      case "harness_cb_recall":
        return await handleRecall(input);
      case "harness_cb_search":
        return await handleSearch(input);
      case "harness_cb_trace":
        return await handleTrace(input);
      case "harness_cb_status":
        return await handleStatus2(input);
      default:
        return errorResult2(`Unknown context-box tool: ${name}`);
    }
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return errorResult2(`Context Box error: ${message}`);
  }
}
var HEALTH_CACHE_MS2, lastHealthyAt2, contextBoxTools;
var init_context_box = __esm({
  "src/tools/context-box.ts"() {
    "use strict";
    init_tool_result();
    HEALTH_CACHE_MS2 = 1e4;
    lastHealthyAt2 = 0;
    contextBoxTools = [
      {
        name: "harness_cb_recall",
        description: "Search the Context Box (business context DB) using TEMPR hybrid retrieval. Finds relevant context from LINE messages, meeting notes, customer data, emails, etc. Supports 4 search strategies: hybrid (best), hybrid-lite, bm25, graph.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query"
            },
            strategy: {
              type: "string",
              enum: ["hybrid", "hybrid-lite", "bm25", "graph", "default"],
              description: "Search strategy. 'hybrid' uses all 4 TEMPR channels (best quality). Default: 'hybrid'"
            },
            limit: {
              type: "number",
              description: "Max results (1-50, default 10)"
            },
            workspace_id: {
              type: "string",
              description: "Workspace ID to scope the search (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)"
            },
            source_type: {
              type: "string",
              enum: [
                "line",
                "slack",
                "chatwork",
                "kintone",
                "email",
                "file",
                "meeting",
                "plaud",
                "omi",
                "fieldy"
              ],
              description: "Filter by data source type"
            },
            group_id: {
              type: "string",
              description: "Filter by group ID (LINE group, Slack workspace, etc.)"
            },
            date_from: {
              type: "string",
              description: "Filter: earliest date (ISO 8601)"
            },
            date_to: {
              type: "string",
              description: "Filter: latest date (ISO 8601)"
            },
            customer: {
              type: "string",
              description: "Filter by customer name"
            },
            author: {
              type: "string",
              description: "Filter by author/speaker"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "harness_cb_search",
        description: "Simplified search for the Context Box (Web UI API). Easier to use than cb_recall \u2014 just provide a query and workspace. Returns text, score, sourceType, documentId, createdAt for each result.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query"
            },
            workspace_id: {
              type: "string",
              description: "Workspace ID (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)"
            },
            strategy: {
              type: "string",
              enum: ["hybrid", "hybrid-lite", "bm25", "graph", "default"],
              description: "Search strategy (default: 'hybrid-lite')"
            },
            limit: {
              type: "number",
              description: "Max results (1-50, default 10)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "harness_cb_trace",
        description: "Retrieve the full raw text and source metadata for a specific document from the Context Box. Use this after recall/search to get the complete original content.",
        inputSchema: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "Document ID (UUID) from recall/search results"
            }
          },
          required: ["document_id"]
        }
      },
      {
        name: "harness_cb_status",
        description: "Check the health and connectivity of the Context Box API. Returns server status, database availability, and feature flags.",
        inputSchema: {
          type: "object",
          properties: {
            detailed: {
              type: "boolean",
              description: "If true, use /health/detailed endpoint for full diagnostics"
            }
          },
          required: []
        }
      }
    ];
  }
});

// src/auth-inject.ts
import * as os from "os";
function resolveUserId(options) {
  const fromEnv = (process.env.HARNESS_MEM_USER_ID || "").trim();
  if (fromEnv) return fromEnv;
  const fromUser = (process.env.USER || process.env.LOGNAME || "").trim();
  if (fromUser) return fromUser;
  if (options.hostname) return options.hostname;
  try {
    const hostname3 = os.hostname();
    return hostname3 || "unknown";
  } catch {
    return "unknown";
  }
}
function resolveTeamId(options) {
  const fromEnv = (process.env.HARNESS_MEM_TEAM_ID || "").trim();
  if (fromEnv) return fromEnv;
  if (options.config?.tokenMap) {
    const mapped = options.config.tokenMap[options.user_id];
    if (mapped) return mapped;
  }
  return options.user_id;
}
function resolveAuthIdentity(options) {
  const user_id = resolveUserId(options);
  const team_id = resolveTeamId({ user_id, config: options.config });
  return { user_id, team_id };
}
function injectAuthFromEnvironment(config2) {
  const identity = resolveAuthIdentity({ config: config2 });
  if (!process.env.HARNESS_MEM_USER_ID) {
    process.env.HARNESS_MEM_USER_ID = identity.user_id;
  }
  if (!process.env.HARNESS_MEM_TEAM_ID) {
    process.env.HARNESS_MEM_TEAM_ID = identity.team_id;
  }
  return identity;
}
var init_auth_inject = __esm({
  "src/auth-inject.ts"() {
    "use strict";
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  pushMemoryNotification: () => pushMemoryNotification
});
async function pushMemoryNotification(message) {
  if (!channelsEnabled) return;
  try {
    await server.notification({
      method: "notifications/message",
      params: { level: "info", data: message }
    });
  } catch {
  }
}
async function main() {
  const identity = injectAuthFromEnvironment();
  console.error(`Harness MCP Server started (user_id=${identity.user_id}, team_id=${identity.team_id})`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
var channelsEnabled, server, allTools;
var init_index = __esm({
  "src/index.ts"() {
    init_server2();
    init_stdio2();
    init_types();
    init_session();
    init_workflow();
    init_status();
    init_code_intelligence();
    init_memory();
    init_context_box();
    init_auth_inject();
    channelsEnabled = process.env.HARNESS_MEM_ENABLE_CHANNELS === "true";
    server = new Server(
      {
        name: "harness-mcp-server",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {},
          ...channelsEnabled ? { logging: {} } : {}
        }
      }
    );
    allTools = [
      ...sessionTools,
      ...workflowTools,
      ...statusTools,
      ...codeIntelligenceTools,
      ...memoryTools,
      ...contextBoxTools
    ];
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: allTools };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        if (name.startsWith("harness_session_")) {
          return await handleSessionTool(name, args);
        }
        if (name.startsWith("harness_workflow_")) {
          return await handleWorkflowTool(name, args);
        }
        if (name.startsWith("harness_status")) {
          return await handleStatusTool(name, args);
        }
        if (name.startsWith("harness_ast_") || name.startsWith("harness_lsp_")) {
          return await handleCodeIntelligenceTool(name, args);
        }
        if (name.startsWith("harness_mem_")) {
          return await handleMemoryTool(name, args);
        }
        if (name.startsWith("harness_cb_")) {
          return await handleContextBoxTool(name, args);
        }
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`
            }
          ],
          isError: true
        };
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : String(error2);
        return {
          content: [
            {
              type: "text",
              text: `Error executing ${name}: ${message}`
            }
          ],
          isError: true
        };
      }
    });
    main().catch((error2) => {
      console.error("Fatal error:", error2);
      process.exit(1);
    });
  }
});
init_index();
export {
  pushMemoryNotification
};
//# sourceMappingURL=index.js.map
