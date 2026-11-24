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

## Автоматичні матеріали Instagram

Блок «Нові матеріали VUZOL» показує до шести останніх публікацій з файлу `dist/assets/instagram-feed.json`. Під час деплою та за розкладом раз на шість годин GitHub Actions оновлює цей файл через офіційний Instagram Graph API.

Для активації потрібні два параметри репозиторію:

- секрет `INSTAGRAM_ACCESS_TOKEN` — дійсний токен доступу Meta;
- змінна `INSTAGRAM_BUSINESS_ACCOUNT_ID` — ID професійного акаунта Instagram.

Токен зберігається тільки у GitHub Secrets, не у коді сайту. Instagram-акаунт має бути професійним і під’єднаним до відповідної сторінки Facebook. Без цих параметрів сайт показує посилання на Instagram, а деплой не завершується помилкою.

## Власність і передання

Репозиторій належить організації ProMedia-Ukraine. Він не залежить від персонального облікового запису ChatGPT.

## Пошук (SEO)

- Сайт працює на домені `https://vuzol.org.ua/`; саме ця адреса вказана в `canonical`, Open Graph, `robots.txt` і `sitemap.xml`.
- Альтернативні назви для пошуку («Вузол», «ВУЗОЛ», «Vuzol») записані в невидимому блоці schema.org (`alternateName`) у `<head>`, а також у `<title>` і `meta description`. На самій сторінці їх не видно.
- Якщо на сайті з'являться нові сторінки, додайте їх у `dist/sitemap.xml`.
