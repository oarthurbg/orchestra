// TypeScript and JavaScript: the language service of the project's own typescript package, called in process.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { Exit } from './core.mjs'

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const slash = f => f.replaceAll('\\', '/')

// The nearest tsconfig.json or jsconfig.json between the file and the project root.
function findConfig(file, root) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name)
    if (path.relative(root, dir) === '' || path.dirname(dir) === dir) return null
  }
}

export const projectDir = (file, root) => path.dirname(findConfig(file, root) ?? file)

// Resolved from the project folder upward, which takes in the root and a package's own copy in a monorepo.
export function loadTs(dir) {
  try { return createRequire(path.join(dir, 'noop.js'))('typescript') } catch { throw new Exit(3, 'no typescript package in this project') }
}

export function tsOutline(ts, text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const line = pos => sf.getLineAndCharacterOfPosition(pos).line
  const scopes = [], imports = new Set(), found = []
  const isFn = n => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n))
  const owner = n => (ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n)) && isFn(n.initializer)
  const named = n => ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n) || ((ts.isFunctionExpression(n) || ts.isClassExpression(n)) && n.name && !owner(n.parent))
  const isRequire = d => d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === 'require'
  const notDecl = new Set([ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.QualifiedName, ts.SyntaxKind.JsxAttribute, ts.SyntaxKind.MetaProperty])
  const visit = n => {
    if (ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n) || (ts.isExportDeclaration(n) && n.moduleSpecifier) ||
      (ts.isVariableStatement(n) && n.declarationList.declarations.some(isRequire))) {
      for (let l = line(n.getStart(sf)); l <= line(n.end); l++) imports.add(l)
    }
    if (owner(n) || named(n)) {
      const at = n.name ? n.name.getStart(sf) : n.getStart(sf)
      const name = n.name ? n.name.getText(sf) : ts.isConstructorDeclaration(n) ? 'constructor' : 'default'
      scopes.push({ name, isClass: ts.isClassLike(n) || (owner(n) && ts.isClassExpression(n.initializer)), at, start: n.name ? n.name.end : at, end: n.end })
    }
    if (ts.isIdentifier(n)) found.push({ text: n.text, offset: n.getStart(sf), decl: n.parent?.name === n && !notDecl.has(n.parent.kind) })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { scopes, imports, ids: name => found.filter(i => i.text === name).map(({ offset, decl }) => ({ offset, decl })) }
}

export function tsServer(ts, file, root) {
  const config = findConfig(file, root)
  let options = { allowJs: true }, names
  if (config) {
    const read = ts.readConfigFile(config, ts.sys.readFile)
    if (read.error) throw new Exit(4, ts.flattenDiagnosticMessageText(read.error.messageText, ' '))
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config))
    options = parsed.options
    names = parsed.fileNames
  } else {
    names = ts.sys.readDirectory(path.dirname(file), EXTS, ['**/node_modules'])
  }
  const f = slash(file)
  if (!names.some(n => n.toLowerCase() === f.toLowerCase())) {
    names = [...names, f]
    if (/\.[cm]?jsx?$/i.test(f)) options = { ...options, allowJs: true }
  }
  const host = {
    getScriptFileNames: () => names,
    getScriptVersion: () => '1',
    getScriptSnapshot: n => { const t = ts.sys.readFile(n); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t) },
    getCurrentDirectory: () => slash(root),
    getCompilationSettings: () => options,
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
  const loc = (fileName, offset) => ({ file: path.resolve(fileName), offset })
  return {
    refs: (f, o) => (ls.findReferences(slash(f), o) ?? []).flatMap(r => r.references).map(r => loc(r.fileName, r.textSpan.start)),
    incoming: (f, o) => [ls.prepareCallHierarchy(slash(f), o) ?? []].flat()
      .flatMap(item => ls.provideCallHierarchyIncomingCalls(item.file, item.selectionSpan.start))
      .flatMap(c => c.fromSpans.map(s => loc(c.from.file, s.start))),
    defs: (f, o) => (ls.getDefinitionAtPosition(slash(f), o) ?? []).map(d => loc(d.fileName, d.textSpan.start)),
    close() {},
  }
}
