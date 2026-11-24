#!/usr/bin/env python3
"""Reproduce numerical experiments and report figures.
Requires Pillow and Matplotlib on author's machine; neither is required by the website.
"""
from pathlib import Path
import subprocess, json
from PIL import Image,ImageOps,ImageDraw,ImageFont
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
TEMP=ROOT/'tools/_experiment_tmp';TEMP.mkdir(exist_ok=True)
SAMPLES=ROOT/'samples';FIG=ROOT/'report/figures';FIG.mkdir(parents=True,exist_ok=True)
files={}
for file in sorted(SAMPLES.glob('*.png')):
    im=Image.open(file).convert('RGBA')
    files[file.stem]={'width':im.width,'height':im.height}
    (TEMP/f'{file.stem}.rgba').write_bytes(im.tobytes())
mask=Image.open(ROOT/'docs/illumination_mask.png').convert('RGBA')
(TEMP/'illumination_mask.rgba').write_bytes(mask.tobytes())
(TEMP/'images.json').write_text(json.dumps(files),encoding='utf8')
subprocess.run(['node',str(ROOT/'tools/compute_experiments.mjs')],cwd=ROOT,check=True)
results=json.loads((ROOT/'report/experiments.json').read_text('utf8'))
cases={r['id']:r for r in results['cases']}
def gray(id):
    c=cases[id];return Image.frombytes('L',(c['width'],c['height']),(TEMP/f'{id}.gray').read_bytes())
def show(id): return np.array(gray(id),dtype=np.uint8)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.titlesize':10,'axes.labelsize':9,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(1,3,figsize=(13,4.0),constrained_layout=True)
for ax,id,title in zip(axes,['contrast_original','contrast_linear','contrast_clahe'],['Исходное изображение','Линейное: 2–98 %','CLAHE: 8×8, clip 2']):
    ax.imshow(gray(id),cmap='gray',vmin=0,vmax=255);ax.set_title(title);ax.axis('off')
fig.savefig(FIG/'contrast_comparison.png',dpi=150,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(13,3.25),constrained_layout=True)
ids=['contrast_original','contrast_linear','contrast_clahe'];maxY=max(max(cases[x]['histogram']) for x in ids)
for ax,id,title in zip(axes,ids,['Исходная','После линейного растяжения','После CLAHE']):
    ax.bar(range(256),cases[id]['histogram'],width=1.0,color='#168476')
    ax.set_title(title);ax.set_xlim(0,255);ax.set_ylim(0,maxY*1.08);ax.set_xlabel('Яркость');ax.set_ylabel('Количество пикселей');ax.grid(axis='y',alpha=.2)
fig.savefig(FIG/'histograms.png',dpi=150,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(2,3,figsize=(12,7.3),constrained_layout=True)
refs=[('doc_original','Исходный документ'),('MASK','Эталонная маска'),('doc_otsu','Оцу'),('doc_mean','Локальное среднее'),('doc_niblack','Ниблэк'),('doc_sauvola','Саувола (k=0,20)')]
for ax,(id,label) in zip(axes.ravel(),refs):
    pic=Image.open(ROOT/'docs/illumination_mask.png').convert('L') if id=='MASK' else gray(id)
    ax.imshow(pic,cmap='gray',vmin=0,vmax=255);ax.axis('off')
    if id in cases and 'segmentation' in cases[id]:label+=f" · F1={cases[id]['segmentation']['f1']:.3f}"
    ax.set_title(label)
fig.savefig(FIG/'document_comparison.png',dpi=140,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(13,4),constrained_layout=True)
for ax,id,title in zip(axes,['doc_original','doc_sauvola_standard','doc_sauvola'],['Исходный документ','Саувола: k=0,34','Саувола: k=0,20']):
    ax.imshow(gray(id),cmap='gray',vmin=0,vmax=255);ax.axis('off');ax.set_title(title)
fig.savefig(FIG/'sauvola_tuning.png',dpi=150,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(13,4),constrained_layout=True)
for ax,id,title in zip(axes,['noise_original','noise_otsu','noise_sauvola'],['Импульсный шум','После Оцу','После Сауволы (31×31)']):
    ax.imshow(gray(id),cmap='gray',vmin=0,vmax=255);ax.axis('off');ax.set_title(title)
fig.savefig(FIG/'noise_comparison.png',dpi=140,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(1,4,figsize=(13,3.5),constrained_layout=True)
a=np.array(gray('border_reflect'));b=np.array(gray('border_clamp'))
for ax,pic,title in zip(axes,[gray('border_original'),gray('border_reflect'),gray('border_clamp'),Image.fromarray(np.where(a!=b,255,0).astype('uint8'))],['Исходный','Reflect-101','Clamp','Различающиеся пиксели']):
    ax.imshow(pic,cmap='gray',vmin=0,vmax=255);ax.axis('off');ax.set_title(title)
fig.savefig(FIG/'border_comparison.png',dpi=150,facecolor='white');plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(13,4),constrained_layout=True)
for ax,id,title in zip(axes,['color_original','color_linear','color_clahe'],['Приглушённая яркость','Линейное растяжение','CLAHE']):
    ax.imshow(gray(id),cmap='gray',vmin=0,vmax=255);ax.axis('off');ax.set_title(title)
fig.savefig(FIG/'color_luma_comparison.png',dpi=140,facecolor='white');plt.close(fig)

protocol=[
 {'image':'Малоконтрастная сцена','method':'Линейное, 2–98 %','purpose':'Проверка растяжения диапазона','result':f"P5–P95: {cases['contrast_original']['statistics']['range']} → {cases['contrast_linear']['statistics']['range']}"},
 {'image':'Малоконтрастная сцена','method':'CLAHE, 8×8, clip 2','purpose':'Проверка локального контрастирования','result':f"Энтропия: {cases['contrast_original']['statistics']['entropy']:.2f} → {cases['contrast_clahe']['statistics']['entropy']:.2f} бит"},
 {'image':'Неравномерное освещение','method':'Оцу (автоматический)','purpose':'Проверка глобального порога','result':f"T={cases['doc_otsu']['info']['threshold']}; F1={cases['doc_otsu']['segmentation']['f1']:.4f}"},
 {'image':'Неравномерное освещение','method':'Среднее, окно 31×31','purpose':'Сравнение локального порога','result':f"F1={cases['doc_mean']['segmentation']['f1']:.4f}"},
 {'image':'Неравномерное освещение','method':'Ниблэк, k=-0,20','purpose':'Оценка влияния дисперсии','result':f"F1={cases['doc_niblack']['segmentation']['f1']:.4f}"},
 {'image':'Неравномерное освещение','method':'Саувола, k=0,20, R=128','purpose':'Адаптивная сегментация текста','result':f"F1={cases['doc_sauvola']['segmentation']['f1']:.4f}"},
 {'image':'Шум «соль-перец»','method':'Оцу и Саувола','purpose':'Ограничения пороговой обработки','result':'Бинаризация не удаляет импульсный шум; визуально видны ложные точки'},
 {'image':'Проверка границ','method':'Ниблэк: Reflect / Clamp','purpose':'Влияние граничных условий','result':f"Отличаются {results['borderDifferences']} пикселей"},
 {'image':'Большой кадр 1680×1050','method':'Локальное среднее, 31×31','purpose':'Проверка многопоточности','result':'Время и совпадение результатов проверяются отдельно в браузере'}
]
(ROOT/'report/protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2),encoding='utf8')
print('FIGURES',list(p.name for p in FIG.glob('*.png')))
