# Адмінка VUZOL

Вхід за логіном і паролем. Зараз у ній редагується блок «Команда»: додати чи прибрати людину, змінити ім'я, посаду, Instagram, фото в кружечку (з вибором кадру) і порядок. Є журнал дій і керування доступами.

## Як це працює

- Адмінка — окремий сервіс на Cloudflare Pages (безкоштовний тариф): сторінка + функції + база D1 з користувачами.
- Кожне збереження стає одним комітом у цьому репозиторії: `content/team.json` і фото в `content/team/`. Повна історія змін є в GitHub, будь-яку версію можна повернути.
- Після коміту workflow «Deploy VUZOL to GitHub Pages» перебудовує сайт (1–3 хвилини). Скрипт `.github/scripts/team_block.py` вписує команду прямо в HTML сторінки.
- Паролі зберігаються лише як хеші (PBKDF2). Після 8 невдалих спроб входу з однієї адреси вхід блокується на 15 хвилин.

## Розгортання (один раз)

1. **Акаунт Cloudflare** на пошту VUZOL (безкоштовний). У ньому: *My Profile → API Tokens → Create Token → Custom token* з правами
   *Account · Cloudflare Pages · Edit* і *Account · D1 · Edit*. Також скопіюйте **Account ID** (праворуч на головній сторінці акаунта).
2. **Ключ GitHub для адмінки:** github.com → Settings → Developer settings → Fine-grained tokens → Generate.
   Власник: *ProMedia-Ukraine*, репозиторій: лише *vuzol*, права: *Contents — Read and write*, *Actions — Read-only*.
3. **У репозиторії** → Settings → Secrets and variables → Actions додайте секрети:
   - `CLOUDFLARE_API_TOKEN` — з кроку 1;
   - `CLOUDFLARE_ACCOUNT_ID` — з кроку 1;
   - `ADMIN_GITHUB_TOKEN` — з кроку 2;
   - `ADMIN_SETUP_CODE` — будь-яка довга фраза, потрібна один раз для створення першого адміністратора.

   І змінну (вкладка *Variables*): `ADMIN_DOMAIN` = `admin.vuzol.org.ua`.
4. **Actions → Deploy VUZOL admin to Cloudflare → Run workflow.** Він сам створить проєкт, базу, таблиці й опублікує адмінку на `https://vuzol-admin.pages.dev`.
5. **В Imena** додайте DNS-запис: тип `CNAME`, ім'я `admin`, значення `vuzol-admin.pages.dev`. Через 5–30 хвилин адмінка відкриватиметься на `https://admin.vuzol.org.ua`.
6. Відкрийте адмінку, введіть код з `ADMIN_SETUP_CODE` і створіть свій обліковий запис. Далі в розділі «Доступи» додайте редакторів.

Ключ GitHub зазвичай діє рік. Коли він закінчиться, адмінка відкриватиметься, але не зберігатиме: створіть новий ключ, оновіть секрет `ADMIN_GITHUB_TOKEN` і перезапустіть workflow.

## Як додати новий блок сайту

1. Винести дані блоку з `index.html` у файл у `content/` і додати скрипт збірки в `.github/scripts/` (за зразком `team_block.py`).
2. Додати модуль у `admin/lib/blocks/` з функціями `load` і `save` (за зразком `team.js`) і рядок у `BLOCKS` у `admin/functions/api/[[path]].js`.
3. Додати сторінку редагування в `admin/public/`.
