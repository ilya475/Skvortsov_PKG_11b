#!/usr/bin/env python3
"""QA-only inline harness for the managed Chromium (which blocks localhost URLs).
Deployment uses the unchanged ES modules and native module workers on GitHub Pages.
"""
from pathlib import Path
import base64,json,re,statistics
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def read(p):return (ROOT/p).read_text(encoding='utf8')
def strip(text):
  text=re.sub(r'^import\s+.*?;\s*','',text,flags=re.MULTILINE)
  return re.sub(r'^export\s+','',text,flags=re.MULTILINE)
source=strip(read('src/pixels.js'))+'\n'+strip(read('src/algorithms.js'))
worker=source+'\n'+strip(read('worker.js'))
worker_url="const workerUrl=URL.createObjectURL(new Blob(["+json.dumps(worker)+"],{type:'application/javascript'}));\n"
app=strip(read('app.js'))
app=app.replace("new Worker(new URL('./worker.js', import.meta.url), {type:'module'})","new Worker(workerUrl, {type:'classic'})")
app=app.replace("fetch(`./samples/${item.file}`)","fetch(sampleUrls[item.file])")
app=app.replace("fetch('./report/protocol.json')","fetch(protocolUrl)")
app=app.replace("import('./tests/self-tests.js')","Promise.resolve({selfTests:window.selfTestsForQa})")
samples={p.name:'data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode('ascii') for p in (ROOT/'samples').glob('*.png')}
protocol_url='data:application/json;base64,'+base64.b64encode((ROOT/'report/protocol.json').read_bytes()).decode('ascii')
client="const sampleUrls="+json.dumps(samples)+";const protocolUrl="+json.dumps(protocol_url)+";\n"+source+'\n'+strip(read('tests/self-tests.js'))+'\nwindow.selfTestsForQa=selfTests;\n'+worker_url+app
html=read('index.html').replace('<link rel="stylesheet" href="styles.css">','<style>'+read('styles.css')+'</style>').replace('<script type="module" src="app.js"></script>','')
html=html.replace('</body>','<script>'+client+'</script></body>')

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
  page.goto('about:blank')
  page.set_content(html,wait_until='load',timeout=30000)
  page.wait_for_function("document.getElementById('beforeCanvas').width===640",timeout=30000)
  assert page.locator('#mode option').count()==6
  assert page.locator('#sampleSelect option').count()==8
  page.screenshot(path=str(ROOT/'report/figures/interface.png'),full_page=True)
  print('Initial',page.locator('#status').inner_text())
  def run_process():
    page.locator('#processBtn').click()
    page.wait_for_function("!document.getElementById('downloadBtn').disabled",timeout=90000)
    return page.locator('#elapsed').inner_text()
  print('Linear',run_process(),page.locator('#thresholdInfo').inner_text())
  page.locator('#mode').select_option('clahe');print('CLAHE',run_process())
  page.locator('#sampleSelect').select_option('1')
  page.wait_for_function("document.getElementById('beforeCanvas').width===760",timeout=30000)
  for mode in ['otsu','local-mean','niblack','sauvola']:
   page.locator('#mode').select_option(mode)
   if mode in ['local-mean','niblack','sauvola']:
    page.locator('#windowSize').fill('31')
   print(mode,run_process(),page.locator('#thresholdInfo').inner_text())
  page.locator('#protocolPanel').evaluate('(node)=>node.open=true')
  page.wait_for_function("document.querySelectorAll('.protocol-table tbody tr').length>=8",timeout=12000)
  page.locator('#testsPanel').evaluate('(node)=>node.open=true')
  page.locator('#runTests').click()
  page.wait_for_timeout(800)
  print('BROWSER TEST DETAIL',page.locator('#testResults').inner_text()[:1500], 'ERRORS', errors[:4])
  page.wait_for_function("document.getElementById('testResults').textContent.includes('31 из 31')",timeout=3500)
  print('UI checks',page.locator('#testResults b').inner_text())
  page.screenshot(path=str(ROOT/'report/figures/interface_processed.png'),full_page=True)
  page.locator('#sampleSelect').select_option('7')
  page.wait_for_function("document.getElementById('beforeCanvas').width===1680",timeout=30000)
  page.locator('#mode').select_option('local-mean')
  page.locator('#windowSize').fill('31')
  timings={}
  for n in ['1','4']:
    page.locator('#threads').select_option(n)
    results=[]
    for j in range(3):
      elapsed=run_process();results.append(float(elapsed.split(' ')[0]))
      if n=='1' and j==2:
       page.evaluate("window.__reference=new Uint8ClampedArray(document.getElementById('afterCanvas').getContext('2d').getImageData(0,0,1680,1050).data)")
    timings[n]=results
    print('Workers',n,results)
  different=page.evaluate('''() => {
    const data=document.getElementById('afterCanvas').getContext('2d').getImageData(0,0,1680,1050).data;
    let n=0; for(let i=0;i<data.length;i++) if(data[i]!==window.__reference[i])n++;
    return n;
  }''')
  print('Byte mismatches',different,'errors',errors[:5])
  assert not errors,errors
  assert different==0,different
  out={'browser':'Chromium headless; QA-only inline bundle of the original module bodies and Blob workers',
     'methods':6,'samples':8,'selfTestsPassed':31,'largeImage':'1680x1050',
     'localMean31_ms':timings,'medianMs':{k:statistics.median(v) for k,v in timings.items()},
     'differentRgbaBytes_1vs4':different,'errors':errors}
  (ROOT/'report/browser_qa.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
  browser.close()
if __name__=='__main__':run()
