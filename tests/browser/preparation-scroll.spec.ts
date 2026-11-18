import {test,expect} from '@playwright/test';
for(const reducedMotion of ['reduce','no-preference'] as const){
 test(`Generate lesson scrolls preparation into view (${reducedMotion})`,async({page})=>{
  await page.emulateMedia({reducedMotion});
  await page.route('**/api/lessons',route=>route.fulfill({json:{id:'mock-preparing',stage:'plan',completed:0,total:16,retryAt:Date.now()+60000}}));
  await page.goto('/');
  await page.getByRole('textbox',{name:'Your mathematics question'}).fill('5x + 7 = 32');
  await page.getByRole('button',{name:'Generate lesson',exact:true}).click();
  const heading=page.getByRole('heading',{name:'Preparing your lesson',exact:true});
  await expect(heading).toBeInViewport();
  await expect.poll(()=>heading.evaluate(e=>{
   const rect=e.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;
  })).toBe(true);
  // Cancel the pending mocked preparation before leaving the page.
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.getByRole('button',{name:'Cancel preparation'}).click();
  await expect(page.getByText(/Preparation paused/)).toBeVisible();
 });
}
