#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { lex } from "../lexer/Lexer.js";
import { parse } from "../parser/Parser.js";
import { obfuscate } from "../obfuscator/Obfuscator.js";
import { compile } from "../vm/Compiler.js";
import { runVM } from "../vm/vm-runner.js";
const args = process.argv.slice(2);
const file = args[0] || join(process.cwd(), "test", "vm-simple-test.luau");
let source;
try {
    source = readFileSync(file, "utf-8");
}
catch {
    source = `print("Hello")
local x = 1 + 2
print(x)
`;
}
console.log("=== VM-Test: Kompilieren und Ausführen ===\n");
console.log("Quellcode:");
console.log(source);
console.log("\n---");
const { tokens, errors } = lex(source);
if (errors.length > 0) {
    console.error("Lexer-Fehler:", errors);
    process.exit(1);
}
const ast = parse(tokens);
const obfuscated = obfuscate(ast, { renameLocals: true, preserveGlobals: true });
const chunk = compile(obfuscated);
console.log("\nK (Konstanten):", JSON.stringify(chunk.K, null, 2));
console.log("\nCode (erste 50):", chunk.code.slice(0, 50).join(","));
const mockEnv = {
    print: (...a) => console.log("[VM]", ...a),
    warn: (...a) => console.warn("[VM warn]", ...a),
    error: (msg) => { throw new Error(String(msg)); },
    assert: (v, msg) => { if (!v)
        throw new Error(msg ? String(msg) : "assertion failed"); return v; },
    type: (v) => {
        if (v === null || v === undefined)
            return "nil";
        if (typeof v === "function")
            return "function";
        if (typeof v === "object")
            return "table";
        return typeof v;
    },
    typeof: (v) => {
        if (v === null || v === undefined)
            return "nil";
        if (typeof v === "function")
            return "function";
        if (typeof v === "object")
            return "table";
        return typeof v;
    },
    tostring: (v) => v === null || v === undefined ? "nil" : String(v),
    tonumber: (v) => { const n = Number(v); return isNaN(n) ? null : n; },
    pcall: (f, ...args) => {
        try {
            const r = f(...args);
            return Array.isArray(r) ? [true, ...r] : [true, r];
        }
        catch (e) {
            return [false, e instanceof Error ? e.message : String(e)];
        }
    },
    select: (idx, ...args) => {
        if (idx === "#")
            return args.length;
        const n = Number(idx);
        if (n >= 1 && n <= args.length)
            return args[n - 1];
        return null;
    },
    pairs: (t) => {
        const keys = Object.keys(t);
        let i = 0;
        return [(..._) => {
                if (i >= keys.length)
                    return [null];
                const k = keys[i++];
                return [k, t[k]];
            }, t, null];
    },
    ipairs: (t) => {
        let i = 0;
        return [(..._) => {
                i++;
                const v = t[i];
                if (v === undefined || v === null)
                    return [null];
                return [i, v];
            }, t, 0];
    },
    next: (t, k) => {
        const keys = Object.keys(t);
        if (k === undefined || k === null)
            return keys.length > 0 ? [keys[0], t[keys[0]]] : [null];
        const idx = keys.indexOf(String(k));
        if (idx < 0 || idx + 1 >= keys.length)
            return [null];
        return [keys[idx + 1], t[keys[idx + 1]]];
    },
    rawget: (t, k) => t[k],
    rawset: (t, k, v) => { t[k] = v; return t; },
    rawequal: (a, b) => a === b,
    setmetatable: (t, _mt) => t,
    getmetatable: (_t) => null,
    string: {
        len: (s) => s.length,
        sub: (s, i, j) => s.substring(i - 1, j),
        rep: (s, n) => s.repeat(n),
        byte: (s, i) => s.charCodeAt((i || 1) - 1),
        char: (...codes) => String.fromCharCode(...codes),
        format: (fmt, ...args) => {
            let i = 0;
            return fmt.replace(/%[dfs%%]/g, (m) => {
                if (m === "%%")
                    return "%";
                return String(args[i++] ?? "");
            });
        },
        find: (s, pattern) => { const idx = s.indexOf(pattern); return idx >= 0 ? [idx + 1, idx + pattern.length] : [null]; },
        lower: (s) => s.toLowerCase(),
        upper: (s) => s.toUpperCase(),
        reverse: (s) => s.split("").reverse().join(""),
        gsub: (s, pattern, repl) => [s.split(pattern).join(repl)],
        match: (s, _pattern) => [null],
    },
    table: {
        insert: (t, ...args) => {
            if (args.length === 1) {
                const keys = Object.keys(t).filter(k => !isNaN(Number(k))).map(Number);
                const len = keys.length > 0 ? Math.max(...keys) : 0;
                t[len + 1] = args[0];
            }
            else {
                t[args[0]] = args[1];
            }
        },
        remove: (t, pos) => {
            const keys = Object.keys(t).filter(k => !isNaN(Number(k))).map(Number).sort((a, b) => a - b);
            const idx = pos || keys[keys.length - 1];
            const val = t[idx];
            delete t[idx];
            return val;
        },
        concat: (t, sep) => {
            const keys = Object.keys(t).filter(k => !isNaN(Number(k))).map(Number).sort((a, b) => a - b);
            return keys.map(k => String(t[k])).join(sep || "");
        },
        sort: () => { },
        unpack: (t, i, j) => {
            const start = i || 1;
            const keys = Object.keys(t).filter(k => !isNaN(Number(k))).map(Number);
            const end = j || (keys.length > 0 ? Math.max(...keys) : 0);
            const results = [];
            for (let k = start; k <= end; k++)
                results.push(t[k]);
            return results;
        },
    },
    math: {
        max: (...a) => Math.max(...a),
        min: (...a) => Math.min(...a),
        floor: (n) => Math.floor(n),
        ceil: (n) => Math.ceil(n),
        abs: (n) => Math.abs(n),
        sqrt: (n) => Math.sqrt(n),
        sin: (n) => Math.sin(n),
        cos: (n) => Math.cos(n),
        random: (m, n) => {
            if (m === undefined)
                return Math.random();
            if (n === undefined)
                return Math.floor(Math.random() * m) + 1;
            return Math.floor(Math.random() * (n - m + 1)) + m;
        },
        huge: Infinity,
        pi: Math.PI,
    },
    bit32: {
        bxor: (...a) => a.reduce((acc, v) => acc ^ v, 0),
        band: (...a) => a.reduce((acc, v) => acc & v, 0xFFFFFFFF),
        bor: (...a) => a.reduce((acc, v) => acc | v, 0),
        bnot: (n) => ~n,
        lshift: (n, b) => n << b,
        rshift: (n, b) => n >>> b,
    },
    coroutine: {},
    os: { clock: () => Date.now() / 1000, time: () => Math.floor(Date.now() / 1000) },
    game: { HttpGet: () => "return {}" },
    workspace: {},
    script: {},
    loadstring: (code) => () => null,
    _G: {},
    shared: {},
    unpack: (t, i, j) => {
        const start = i || 1;
        const keys = Object.keys(t).filter(k => !isNaN(Number(k))).map(Number);
        const end = j || (keys.length > 0 ? Math.max(...keys) : 0);
        const results = [];
        for (let k = start; k <= end; k++)
            results.push(t[k]);
        return results;
    },
};
mockEnv._G = mockEnv;
console.log("\n--- Ausführung ---\n");
try {
    const result = runVM(chunk.K, chunk.code, mockEnv, 0, chunk.protos || []);
    console.log("\nRückgabewert:", result);
    console.log("\n✓ VM-Test erfolgreich");
}
catch (err) {
    console.error("\n✗ VM-Fehler:", err);
    process.exit(1);
}
//# sourceMappingURL=vm-test.js.map