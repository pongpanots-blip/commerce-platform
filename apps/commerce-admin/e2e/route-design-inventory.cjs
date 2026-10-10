// Read-only route/source review. Byte/AST evidence is distinct from browser/state validation.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ts = require('typescript');
const base = 'e4346b7687c196ba4a1a8ca276e74448b90c3317';
const priorBase = '69b13b2d188d4f7fb1d9bfbe5136fa693fc0bbf9';
const folder = 'docs/reviews/admin-task-navigation';
const protectedRows = JSON.parse(fs.readFileSync(`${folder}/route-protection.json`, 'utf8')).routes;
const cache = new Map();
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const gitContent = (ref, file) => {
  const result = cp.spawnSync('git', ['show', `${ref}:${file}`]);
  return result.status === 0 ? result.stdout : null;
};
const resolve = (file, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const stem = path.join(path.dirname(file), specifier);
  return [stem,`${stem}.tsx`,`${stem}.ts`,`${stem}/index.tsx`,`${stem}/index.ts`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};
function info(file) {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(file,'utf8');
  const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const item = {file,bytes:Buffer.byteLength(text),imports:new Map(),dependencies:[],routes:[],layoutClasses:[],headings:[],controls:[],feedback:[],apiCalls:[],hooks:[]};
  cache.set(file,item);
  for(const statement of source.statements) {
    if(ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
      const dep=resolve(file,statement.moduleSpecifier.text);
      if(dep) {
        item.dependencies.push(dep);
        const clause=statement.importClause;
        if(clause?.name)item.imports.set(clause.name.text,dep);
        if(clause?.namedBindings && ts.isNamedImports(clause.namedBindings))for(const binding of clause.namedBindings.elements)if(!binding.isTypeOnly)item.imports.set(binding.name.text,dep);
      }
    }
    if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations) {
      let lazy;
      function scan(node) {
        if(ts.isCallExpression(node) && node.expression.kind===ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]))lazy=resolve(file,node.arguments[0].text);
        ts.forEachChild(node,scan);
      }
      if(declaration.initializer)scan(declaration.initializer);
      if(lazy && ts.isIdentifier(declaration.name)){item.dependencies.push(lazy);item.imports.set(declaration.name.text,lazy);}
    }
  }
  const ignored = new Set(['TaskRoute','Suspense','Routes','Route','Navigate','Loading','QueryClientProvider','TaskPageFrame','AppShell','NavProvider','Outlet']);
  function visit(node) {
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
      const tag=node.tagName.getText(source);
      const attrs=node.attributes.properties;
      const attr=name=>attrs.find(value=>ts.isJsxAttribute(value)&&value.name.text===name);
      const literal=value=>value?.initializer && ts.isStringLiteral(value.initializer)?value.initializer.text:null;
      if(tag==='Route') {
        const route={path:literal(attr('path')),component:null,source:null,redirect:false,redirectTo:null,boundary:false};
        function leaf(child) {
          if(ts.isJsxOpeningElement(child)||ts.isJsxSelfClosingElement(child)) {
            const name=child.tagName.getText(source);
            if(name==='Navigate') {
              route.redirect=true;
              const target=child.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.text==='to');
              route.redirectTo=literal(target);
            }
            if(!ignored.has(name)&&item.imports.has(name)) {route.component=name;route.source=item.imports.get(name);}
            else if(!ignored.has(name)&&!route.component){route.component=name;route.source=file;}
          }
          ts.forEachChild(child,leaf);
        }
        const element=attr('element');if(element)leaf(element);
        if(route.redirect&&route.component&&!['Workspace','LoginRedirect','SampleRequestsRedirect'].includes(route.component)) {
          route.conditionalRedirect=true;route.redirect=false;
        }
        if(route.path) {route.boundary=route.path.includes('*');item.routes.push(route);}
      }
      const classes=attr('className');
      if(classes)item.layoutClasses.push({line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,expression:classes.initializer?.getText(source)});
      if(['PageHeader','PanelHead','FormPanel','TaskPanelForm','h1','h2'].includes(tag))item.headings.push({tag,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,title:attr('title')?.initializer?.getText(source)});
      if(/^(?:Task)?(?:Input|Select|Textarea|MasterDataSelect|Form|FormPanel)$/.test(tag)||['form','input','select','textarea'].includes(tag))item.controls.push(tag);
      if(['Loading','ErrorText','Empty','EmptyState','Alert','Hint','StatusChip','Chip','InterruptedAction'].includes(tag))item.feedback.push(tag);
    }
    if(ts.isCallExpression(node)) {
      const expression=node.expression.getText(source);
      if(/Api\.|api\.|\brequest\b|apiGet|apiPost|apiPatch|apiDelete|\.mutate/.test(expression))item.apiCalls.push(expression);
      if(/^use[A-Z]/.test(expression))item.hooks.push(expression);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  const previous=gitContent(base,file);
  item.sha256=digest(text);item.upstreamSha256=previous?digest(previous):null;item.sourceUnchangedFromUpstream=!!previous && item.sha256===item.upstreamSha256;
  for(const key of ['dependencies','controls','feedback','apiCalls','hooks'])item[key]=[...new Set(item[key])];
  return item;
}
const runtime=[];
for(const [app,file,prefix] of [
  ['admin','apps/commerce-admin/src/app/app.tsx',''],
  ['admin','apps/commerce-admin/src/josh-admin/JoshAdminApp.tsx','/j/'],
  ['portal','apps/commerce-portal/src/app/app.tsx',''],
])for(const route of info(file).routes)runtime.push({...route,app,path:prefix+route.path,routerSource:file});
const byPath=new Map();
const shadowedRoutes=[];
for(const route of runtime) {
  const key=`${route.app}:${route.path}`;
  // An exact outer admin route takes precedence over its nested /j/* equivalent.
  if(byPath.has(key))shadowedRoutes.push(route);else byPath.set(key,route);
}
const adminLogin=byPath.get('admin:/login');
if(adminLogin)Object.assign(adminLogin,{component:'Login',source:'apps/commerce-admin/src/app/pages/Login.tsx',authenticatedHandler:'LoginRedirect',publicAuthGate:true});
for(const prior of protectedRows) {
  const key=`${prior.app}:${prior.path}`;
  if(!byPath.has(key))byPath.set(key,{app:prior.app,path:prior.path,source:prior.source,component:prior.component,routerSource:null,redirect:prior.kind==='redirect',redirectTo:null,boundary:false,concreteExpansion:true});
}
const features=fs.readFileSync('apps/commerce-admin/src/app/features.ts','utf8');
const navigation=fs.readFileSync('apps/commerce-admin/src/app/navigation.ts','utf8');
const aliases=[...new Set([...features.matchAll(/'\/josh\/([^']+)'/g),...navigation.matchAll(/to: '\/josh\/([^']+)'/g)].map(match=>match[1]))];
for(const view of aliases)byPath.set(`admin:/josh/${view}`,{...byPath.get('admin:/josh/:view'),path:`/josh/${view}`,concreteExpansion:true});
const uncertainty=new Set(['SalesAssignment','MyWinback']);
const changed=new Set(['CsDesk','SampleRequestsRedirect','StockMoves','StaffAccounts','Integrations','ProductMasterQueue','Products','Customers','Order']);
const sources=new Map();
const records=[...byPath.values()].map(route=>{
  if(['Workspace','SampleRequestsRedirect'].includes(route.component)||['/cs','/stock-moves'].includes(route.path))route.redirect=true;
  const prior=protectedRows.find(row=>row.app===route.app&&row.path===route.path)??protectedRows.find(row=>row.source===route.source);
  const source=route.source && fs.existsSync(route.source)?info(route.source):null;
  if(source)sources.set(source.file,source);
  let dependencyChanges=[];
  for(const dep of source?.dependencies??[])if(/^(?:apps\/commerce-(?:admin|portal)\/src)/.test(dep)&&fs.existsSync(dep)) {
    const dependency=info(dep);sources.set(dep,dependency);
    if(!dependency.sourceUnchangedFromUpstream)dependencyChanges.push(dep);
  }
  const behaviorChanged=route.app==='admin'&&(changed.has(route.component)||dependencyChanges.includes('apps/commerce-admin/src/app/components/ResourcePage.tsx')||['/inventory','/j/cs/sample-requests'].includes(route.path));
  const status=behaviorChanged?'behavior-changed-family-tested':uncertainty.has(route.component)?'unreviewed-visual-provenance':source?.sourceUnchangedFromUpstream?'protected-render-source-reviewed-unchanged':'unreviewed-or-routing-container';
  const kind=route.boundary?'routing-container':route.redirect?'redirect':route.path.includes(':')?'route-family':'page-or-concrete-action';
  const family=prior?.category??(route.app==='portal'?'Portal':route.path.split('/').slice(0,3).join('/')||'Home');
  const evidence=behaviorChanged?['current combined-tree tests/browser receipts, when recorded; see exact file/check mapping']:source?.sourceUnchangedFromUpstream?['full leaf source read by TypeScript AST','byte comparison with e4346b7','fresh mocked layout review recorded separately; hash equality does not establish all-state pixel equivalence']:['no complete page/visual review claim'];
  return {...route,kind,family,classification:status,stitchReference:prior?.stitchReference??null,referenceType:prior?.referenceType??null,sourceSha256:source?.sha256??null,sourceUnchangedFromUpstream:source?.sourceUnchangedFromUpstream??null,changedDependencies:dependencyChanges,evidence,visualStates:'Loaded/empty/loading/error/action state coverage is limited to explicitly recorded browser cases. No live dependency or all-state visual claim.'};
});
const browserRoutes=records.filter(route=>!route.boundary&&!route.redirect&&route.source&&!(route.path==='/login'||route.path==='/register'||route.path.includes(':view')||route.path.includes(':workspaceId')||route.path.includes(':task'))).map(route=>({...route,path:route.path}));
const cleanSource=source=>({...source,imports:Object.fromEntries(source.imports)});
const output={generatedAt:new Date().toISOString(),base,priorBase,method:'Complete router AST plus existing concrete/provenance records; full routed leaf/direct dependency source reads and exact byte comparison. This is a bounded source/design inventory, not all-state visual or live business acceptance.',sharedVisualDependencies:{unchangedFromUpstream:['libs/ui/src/data-table.tsx','libs/ui/table.css','libs/ui/theme.css','libs/ui/src/usability.tsx'],indexResolution:'Upstream TableViewport/cp-data-table/Pager preserved; optional scrollLabel maps to label; navigation and action feedback changes explicitly authorized.'},counts:{records:records.length,runtimeRoutePatterns:runtime.length,browserRouteRecords:browserRoutes.length,uniqueSourceFiles:sources.size,classifications:Object.fromEntries([...new Set(records.map(row=>row.classification))].map(key=>[key,records.filter(row=>row.classification===key).length]))},records,shadowedRoutes,sources:[...sources.values()].map(cleanSource),routes:browserRoutes,files:[...sources.keys()],elements:[...sources.values()].reduce((sum,row)=>sum+row.controls.length,0),remainingLiveAcceptance:[{path:'/cs/accounts/merge',reason:'Live merge response contract unavailable under current permission; explicit merged:true only, outcome remains unknown otherwise.'},{path:'/j/allproducts',reason:'Inherited upstream bulk approval/rejection assumes HTTP resolution and defaults missing count to zero; authoritative receipt and interrupted-flow guarantees are outside this slice.'}],unreviewedDimensions:['Screen readers','Safari/Firefox','Live service/database persistence','All conditional states and business rules of unchanged legacy workflows','Actual browser zoom control (separate action runner checks equivalent CSS widths)']};
fs.writeFileSync(`${folder}/every-page-inventory.json`,JSON.stringify(output,null,2)+'\n');
const lines=['# Every-page route and design inventory','','Expected upstream base: `'+base+'`. All routes/families are enumerated from current router ASTs and preserved concrete/provenance records. Source reads and hashes are source review evidence; they do not prove full visual/state correctness. Fresh local fixture layout visits are recorded separately.','','| App | Route/family | Source/component | Classification | Stitch reference |','| --- | --- | --- | --- | --- |'];
for(const row of records)lines.push(`| ${row.app} | \`${row.path}\` | ${row.component??'router'} | ${row.classification} | ${row.stitchReference??'inherited/uncertain; see JSON'} |`);
lines.push('','No route is silently treated as fully audited. Unknown provenance, routing containers, conditional states, live dependencies and business acceptance gaps remain explicit. See the JSON for leaf/direct dependency summaries, hashes and recorded coverage.');
fs.writeFileSync(`${folder}/every-page-inventory.md`,lines.join('\n')+'\n');
console.log(JSON.stringify(output.counts));
