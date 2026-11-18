import { readdir, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
// Copy an explicit source allowlist, never recursively copy the project root.
const target=process.argv[2];
if(!target||!path.isAbsolute(target)||(path.resolve(target)===process.cwd()||path.resolve(target).startsWith(process.cwd()+path.sep))){console.error('Usage: npm run package:source -- /absolute/empty/output-directory');process.exit(1);}
try{const entries=await readdir(target);if(entries.length)throw new Error();}catch(e){if(e.code!=='ENOENT'){console.error('Output directory must be empty.');process.exit(1);}}
await mkdir(target,{recursive:true});
const files=['package.json','package-lock.json','README.md','AGENTS.md','next-env.d.ts','tsconfig.json','postcss.config.mjs','vitest.config.ts','playwright.config.ts','.env.example','.gitignore','.vercelignore','.gitattributes','.nvmrc'];
async function copy(dir,dest){await mkdir(dest,{recursive:true});for(const item of await readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink()||['node_modules','.next','.cache','.git'].includes(item.name)||item.name.startsWith('.env')&&item.name!=='.env.example')continue;const src=path.join(dir,item.name),out=path.join(dest,item.name);if(item.isDirectory())await copy(src,out);else if(item.isFile())await copyFile(src,out);}}
for(const file of files)try{await copyFile(file,path.join(target,file));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const dir of ['src','public','scripts','migrations','docs','tests'])try{await copy(dir,path.join(target,dir));}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('Source package prepared without environment secrets, dependencies, builds or runtime caches.');
