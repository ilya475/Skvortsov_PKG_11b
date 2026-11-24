#!/usr/bin/env python3
"""Render the corrected report from the previous report design, with measured data.
Requires: mistune, BeautifulSoup, WeasyPrint. The deployed website has no Python deps.
"""
import re, json, statistics
from pathlib import Path
import mistune
from bs4 import BeautifulSoup
from weasyprint import HTML
ROOT=Path(__file__).resolve().parents[1]
experiments=json.loads((ROOT/'report/experiments.json').read_text('utf8'))
qa=json.loads((ROOT/'report/browser_qa.json').read_text('utf8'))
cases={item['id']:item for item in experiments['cases']}

def pretty(v,field):
  if isinstance(v,bool):return str(v)
  if isinstance(v,int):return str(v)
  if isinstance(v,float):
    if field in {'f1','precision','recall'}:return f'{v:.4f}'.replace('.',',')
    return f'{v:.2f}'.replace('.',',')
  return str(v)

def replacement(match):
  key=match.group(1)
  if key=='border.diff':return str(experiments['borderDifferences'])
  if key=='border.percent':return f"{100*experiments['borderDifferences']/(240*240):.2f}".replace('.',',')
  if key.startswith('bench.'):
    field=key.removeprefix('bench.')
    keys={'one0':qa['localMean31_ms']['1'][0],'one1':qa['localMean31_ms']['1'][1],'one2':qa['localMean31_ms']['1'][2],
          'four0':qa['localMean31_ms']['4'][0],'four1':qa['localMean31_ms']['4'][1],
          'four2':qa['localMean31_ms']['4'][2],'oneMedian':qa['medianMs']['1'],
          'fourMedian':qa['medianMs']['4'], 'speed':qa['medianMs']['1']/qa['medianMs']['4'],
          'mismatch':qa['differentRgbaBytes_1vs4']}
    return pretty(keys[field],field)
  parts=key.split('.')
  if parts[0] not in cases:raise KeyError(key)
  cur=cases[parts[0]]
  for part in parts[1:]:cur=cur[part]
  return pretty(cur,parts[-1])

source=(ROOT/'report/Отчет_Скворцов_ЛР3_исходник.md').read_text('utf8')
markdown=re.sub(r'\{\{([a-zA-Z0-9_.-]+)\}\}',replacement,source)
if '{{' in markdown:raise RuntimeError('Placeholder not substituted')
(ROOT/'report/Отчет_Скворцов_ЛР3.md').write_text(markdown,encoding='utf8')
renderer=mistune.create_markdown(renderer=mistune.HTMLRenderer(escape=False),plugins=['table','strikethrough'])
soup=BeautifulSoup(renderer(markdown),'html.parser')
links=[]
for i,heading in enumerate(soup.select('h2'),1):
  heading['id']=f'section-{i}'
  links.append((f'#section-{i}',heading.get_text(' ',strip=True)))
for p in list(soup.find_all('p')):
  imgs=p.find_all('img',recursive=False)
  if len(imgs)!=1 or len(p.contents)!=1:continue
  img=imgs[0];fig=soup.new_tag('figure');cap=soup.new_tag('figcaption')
  cap.string=img.get('alt','Иллюстрация');img.extract();fig.append(img);fig.append(cap);p.replace_with(fig)
nav='\n'.join(f'<a href="{link}">{label}</a>' for link,label in links)
html=f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Отчёт Скворцова Ильи, группа 11. Лабораторная работа 3: шесть методов цифровой обработки, теория, эксперименты и вывод.">
<title>Отчёт ЛР №3 — Скворцов Илья</title><link rel="stylesheet" href="report.css"><link rel="icon" href="favicon.svg" type="image/svg+xml"></head>
<body><header class="report-bar"><span class="titlemark">ЛАБОРАТОРНАЯ №3 / ЭКСПЕРИМЕНТАЛЬНЫЙ ОТЧЁТ</span><nav><a href="index.html">← Приложение</a><a href="report/Отчет_Скворцов_Илья_ЛР3.pdf">Скачать PDF ↓</a></nav></header>
<div class="report-layout"><aside class="report-toc"><h3>Содержание</h3>{nav}</aside>
<article class="report-paper">{str(soup)}<p class="report-bottom">Все измерения основаны на исходном коде и тестовых данных из того же архива. Исходный текст и экспериментальный протокол доступны в папке report/.</p></article></div></body></html>'''
(ROOT/'report.html').write_text(html,encoding='utf8')
file=ROOT/'report/Отчет_Скворцов_Илья_ЛР3.pdf'
HTML(string=html,base_url=str(ROOT)).write_pdf(str(file))
print('PDF',file,'bytes',file.stat().st_size,'HTML',len(html),'chars')
