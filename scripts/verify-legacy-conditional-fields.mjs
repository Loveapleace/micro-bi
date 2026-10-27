import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),out=path.join(root,'doc/verification/ignore-legacy-conditional-fields-2026-10-27');
const {chromium}=createRequire(path.resolve(root,'../dynamic-data-test/package.json'))('playwright');
const fixturePath='test/fixtures/legacy-conditional-browser.json';
const fixtures=JSON.parse(await fs.readFile(path.join(root,fixturePath),'utf8'));
const results=[],browser=await chromium.launch({headless:true});
await fs.mkdir(out,{recursive:true});
try{
  for(const [index,view]of fixtures.entries()){
    const context=await browser.newContext({viewport:{width:1920,height:1080},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(view=>{if(location.origin==='http://localhost:5174'&&!sessionStorage.getItem('seeded')){localStorage.setItem('mbi_dashboard_views_v3',JSON.stringify([view]));sessionStorage.setItem('seeded','1');}},view);
    await page.goto('http://localhost:5174/');
    const card=page.locator('.ant-col').filter({has:page.getByText(view.title,{exact:true})}).last();await card.waitFor();
    await card.getByText('配置',{exact:true}).click();
    const modal=page.getByRole('dialog').filter({has:page.getByText('向导配置面板',{exact:true})});await modal.waitFor();
    assert.equal(await modal.getByText('配置尚未通过校验，预览和保存已阻止',{exact:true}).count(),0);
    assert.equal(await modal.getByText('旧条件配置不受支持，请使用条件规则新模型重新配置',{exact:true}).count(),0);
    await modal.getByText('动态展开预览 (数据)',{exact:true}).click();await page.waitForTimeout(700);
    const nameBox=modal.getByRole('textbox').nth(3);await nameBox.fill('D4:D16');await nameBox.press('Enter');
    await page.keyboard.press('Control+c');await page.waitForTimeout(150);const display=await page.evaluate(()=>navigator.clipboard.readText());
    await page.screenshot({path:path.join(out,`verified-${index+1}-preview.png`)});
    await modal.getByRole('button',{name:'保存报表',exact:true}).click();await modal.waitFor({state:'hidden'});
    await page.reload();await card.waitFor();
    await card.locator('canvas').last().click({position:{x:50,y:85}});await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.waitForTimeout(150);
    const vtable=await page.evaluate(()=>navigator.clipboard.readText());
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mbi_dashboard_views_v3'))[0]);
    const counts=text=>['低产','关注','正常'].map(v=>text.split(v).length-1),expected=index?[5,4,4]:[0,0,0];
    assert.deepEqual(counts(display),expected);assert.deepEqual(counts(vtable),expected);
    assert.equal(saved.cellBundle.template.presentationRules.ruleSets.flatMap(s=>s.rules).length,index?3:0);
    await card.getByText('配置',{exact:true}).click();await modal.waitFor();assert.equal(await modal.getByText('配置尚未通过校验，预览和保存已阻止',{exact:true}).count(),0);
    await modal.getByRole('button',{name:/取\s*消/}).click();
    assert.deepEqual(errors,[]);
    results.push({scenario:view.title,passed:true,previewAndSaveUnblocked:true,reopenUnblocked:true,previewCounts:counts(display),vtableCounts:counts(vtable),savedRules:index?3:0,pageErrors:errors});
    console.log(JSON.stringify(results.at(-1)));await context.close();
  }
}finally{
  await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({isolatedContexts:true,fixtures:fixturePath,results},null,2));await browser.close();
}
