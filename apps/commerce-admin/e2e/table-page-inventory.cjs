// Inventory actual JSX and route imports; comments and the shared renderer are excluded.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const cache = new Map();
function info(file) {
  if (cache.has(file)) return cache.get(file);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result = { file, imports: new Map(), deps: [], tables: [], routes: [] };
  cache.set(file, result);
  const dependency = (specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(file), specifier);
    for (const candidate of [
      base,
      base + '.tsx',
      base + '.ts',
      base + '/index.tsx',
      base + '/index.ts',
    ]) {
      if (/\.(tsx?|jsx?)$/.test(candidate) && fs.existsSync(candidate)) {
        const relative = path.relative(root, candidate);
        if (
          /^apps\/commerce-(admin|portal)\/src\//.test(relative) &&
          !relative.includes('/libs/')
        )
          return relative;
      }
    }
    return null;
  };
  const add = (specifier) => {
    const dep = dependency(specifier);
    if (dep) result.deps.push(dep);
    return dep;
  };
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      !statement.importClause?.isTypeOnly
    ) {
      const dep = add(statement.moduleSpecifier.text);
      if (dep && statement.importClause) {
        if (statement.importClause.name)
          result.imports.set(statement.importClause.name.text, dep);
        const bindings = statement.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            if (!binding.isTypeOnly) result.imports.set(binding.name.text, dep);
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      !statement.isTypeOnly
    )
      add(statement.moduleSpecifier.text);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        let lazyFile;
        function lazy(node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            ts.isStringLiteral(node.arguments[0])
          )
            lazyFile = add(node.arguments[0].text);
          ts.forEachChild(node, lazy);
        }
        if (declaration.initializer) lazy(declaration.initializer);
        if (lazyFile && ts.isIdentifier(declaration.name))
          result.imports.set(declaration.name.text, lazyFile);
      }
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === 'Table' || tag === 'table')
        result.tables.push({
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          tag,
        });
      if (tag === 'Route') {
        const attrs = node.attributes.properties;
        const routePath = attrs.find(
          (a) => ts.isJsxAttribute(a) && a.name.text === 'path',
        );
        const element = attrs.find(
          (a) => ts.isJsxAttribute(a) && a.name.text === 'element',
        );
        const route = {
          path: routePath?.initializer?.text,
          file: null,
          redirect: false,
        };
        function component(child) {
          if (
            ts.isJsxSelfClosingElement(child) ||
            ts.isJsxOpeningElement(child)
          ) {
            const name = child.tagName.getText(source);
            if (name === 'Navigate') route.redirect = true;
            if (result.imports.has(name))
              route.file ??= result.imports.get(name);
          }
          ts.forEachChild(child, component);
        }
        if (element) component(element);
        if (route.path && route.file && !route.path.includes('*'))
          result.routes.push(route);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function tableFiles(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  const item = info(file);
  return [
    ...(item.tables.length ? [file] : []),
    ...item.deps.flatMap((dep) => tableFiles(dep, seen)),
  ];
}
const routes = [];
for (const [app, entry, prefix] of [
  ['admin', 'apps/commerce-admin/src/app/app.tsx', ''],
  ['admin', 'apps/commerce-admin/src/josh-admin/JoshAdminApp.tsx', '/j/'],
  ['portal', 'apps/commerce-portal/src/app/app.tsx', ''],
]) {
  for (const route of info(entry).routes) {
    const files = [...new Set(tableFiles(route.file))];
    if (files.length)
      routes.push({
        app,
        path: prefix + route.path,
        componentFile: route.file,
        tableFiles: files,
      });
  }
}
function scan(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) scan(file);
    else if (
      /\.tsx$/.test(file) &&
      !/\.(test|spec)\.tsx$/.test(file) &&
      !file.includes('/libs/')
    )
      info(file);
  }
}
scan('apps/commerce-admin/src');
scan('apps/commerce-portal/src');
const files = [...cache.values()]
  .filter((item) => item.tables.length)
  .map(({ file, tables }) => ({
    file,
    tables,
    routes: routes
      .filter((route) => route.tableFiles.includes(file))
      .map((route) => `${route.app}:${route.path}`),
  }));
const inventory = {
  generatedOn: '2026-10-09',
  method: 'TypeScript JSX and local import graph; application sources only',
  elements: files.reduce((n, f) => n + f.tables.length, 0),
  files,
  routes,
};
const output =
  process.argv[2] ?? 'docs/reviews/table-page-inventory-2026-10-09.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(inventory, null, 2) + '\n');
console.log(
  `${inventory.elements} actual JSX tables in ${files.length} application files; ${routes.filter((r) => r.app === 'admin').length} admin routes and ${routes.filter((r) => r.app === 'portal').length} portal routes. ${files.filter((f) => !f.routes.length).length} unrouted source files.`,
);
