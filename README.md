# VUZOL

Вихідний код і медіафайли односторінкового сайту VUZOL — медіа про історію української музики.

## Актуальна версія

Повний каталог `dist/` зібраний у двох частинах архіву:

- `vuzol-site-dist.zip.part-000`
- `vuzol-site-dist.zip.part-001`

Це технічний формат завантаження великих медіафайлів через вебінтерфейс GitHub. Після злиття PR workflow GitHub Actions автоматично відновлює `dist/` та публікує сайт через GitHub Pages.

Для локального відновлення:

```bash
cat vuzol-site-dist.zip.part-000 vuzol-site-dist.zip.part-001 > vuzol-site-dist.zip
unzip vuzol-site-dist.zip
```

Після цього відкрийте `dist/index.html` у браузері або опублікуйте каталог `dist/` на статичному хостингу.

## Власність і передання

Репозиторій належить організації ProMedia-Ukraine. Він не залежить від персонального облікового запису ChatGPT.