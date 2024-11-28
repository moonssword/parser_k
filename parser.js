const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const fsExtra = require('fs-extra');
const puppeteer = require('puppeteer');
const DB = require('./db-manager');
const moment = require('moment');
const path = require('path');

const logFileName = `log_${moment().format('YYYY-MM-DD_HH-mm-ss')}.txt`;
const logDir = path.join(__dirname, 'logs');
const logFilePath = path.join(logDir, logFileName);

// Функция для записи в файл логов
fsExtra.ensureDirSync(logDir);
function logToFile(message) {
    fs.appendFileSync(logFilePath, `${moment().format('YYYY-MM-DD HH:mm:ss')} - ${message}\n`);
}

// Настраиваем axios с таймаутом
const instance = axios.create({
    timeout: 5000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    }
});

// Чтение конфигурационного файла
const config = require('./searchConfig.json');

function buildSearchUrl(config, page, city) {
    let url = `${config.base_url}/${config.params.type}/${config.params.space}/${city}/`;
    const params = [];

    // Add has_photos parameter if specified
    if (config.params.has_photos) {
        params.push('das[_sys.hasphoto]=1');
    }

    // Add from_owner parameter if specified
    if (config.params.from_owner) {
        params.push('das[who]=1');
    }

    // Handle the rooms parameter (single or multiple rooms)
    if (config.params.rooms && config.params.rooms.length > 0) {
        if (config.params.rooms.length === 1) {
            params.push(`das[live.rooms]=${config.params.rooms[0]}`);
        } else {
            for (const room of config.params.rooms) {
                params.push(`das[live.rooms][]=${room}`);
            }
        }
    }

    // Handle pagination for rental period
    if (page > 1 && config.params.type === "arenda") {
        params.push(`rent-period-switch=%2F${config.params.type}%2F${config.params.space}&page=${page}`);
    }

    // Construct the final URL
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    return url;
}

// Функция для загрузки страницы с повторными попытками
async function fetchPageWithRetry(url, retries = 3, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await instance.get(url);
            return response.data;
        } catch (error) {
            logToFile(`Не удалось загрузить страницу: ${error}`);
            if (i === retries - 1) {
                console.error(`Не удалось загрузить страницу: ${url} после ${retries} попыток`);
                return null;
            }
            console.log(`Повторная попытка загрузки страницы: ${url} через ${delay / 1000} секунд`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Функция для парсинга общего количества объявлений
/*function parseTotalAds(html) {
    const $ = cheerio.load(html);
    const nbTotalText = $('.kr-btn .nb-total').text();
    const match = nbTotalText.match(/\((\d+)\)/);
    return match ? parseInt(match[1].replace(/\s+/g, ''), 10) : 0;
}*/

// Функция для парсинга ссылок на объявления и параметров продвижения
async function parseAdLinks(html) {
    const $ = cheerio.load(html);
    const adLinks = [];

    try {
        $('a.a-card__title').each((i, elem) => {
            const link = $(elem).attr('href');
    
            if (link) {
                const adUrl = config.base_url + link;
                const promotions = [];
    
                // Найти родительский элемент, который содержит иконки продвижения
                const parentElement = $(elem).closest('.a-card__descr');
    
                // Извлечь параметры продвижения из родительского элемента
                parentElement.find('.paid-icon').each((i, iconElem) => {
                    const iconClass = $(iconElem).find('span').first().attr('class');
    
                    // Определение текста на основе класса иконки
                    switch (true) {
                        case iconClass.includes('fi-paid-hot'):
                            promotions.push('hot');
                            break;
                        case iconClass.includes('fi-paid-up'):
                            promotions.push('up');
                            break;
                        case iconClass.includes('fi-paid-fast'):
                            promotions.push('x5');
                            break;
                        case iconClass.includes('fi-paid-urgent'):
                            promotions.push('urgent');
                            break;
                        case iconClass.includes('fi-paid-turbo'):
                            promotions.push('x15');
                            break;
                        default:
                            promotions.push('unknown');
                            break;
                    }
                });
    
                adLinks.push({
                    url: adUrl,
                    promotions: promotions // Включаем параметры продвижения вместе с ссылкой на объявление
                });
            }
        });
    
        //console.log(JSON.stringify(adLinks)); // Для отладки
        return adLinks;
    } catch (err) {
        logToFile(`Не удалось получить ссылки для объявлений: ${err}`);
    }
}

// Функция для парсинга данных с объявления, включая получение номера телефона через Puppeteer
async function parseAdDetailsWithPhonePuppeteer(adUrl) {
    const browser = await puppeteer.launch({ headless: true }); // false для отображения содержимого браузера
    const page = await browser.newPage();

    try {
        // Переход на страницу объявления
        await page.goto(adUrl, { waitUntil: 'domcontentloaded'/*, timeout: 5000 */});

        // Закрываем всплывающее окно, если оно появилось
        try {
            await page.waitForSelector('.tutorial__close.notes-tutorial__close');
            await page.click('.tutorial__close.notes-tutorial__close');
        } catch (error) {
            logToFile(`Всплывающее окно не найдено или не отображается: ${error}`);
            console.log('Всплывающее окно не найдено или не отображается.');
        }

        // Ожидание кнопки "Показать телефон" и клик по ней
        await page.waitForSelector('.show-phones', { visible: true });
        await page.click('.show-phones');

        // Ожидание отображения номера телефона
        await page.waitForSelector('.offer__contacts-phones p', { visible: true });

        // Извлечение номера телефона
        const phone = await page.evaluate(() => {
            const phoneElement = document.querySelector('.offer__contacts-phones p');
            return phoneElement ? phoneElement.textContent.trim() : null;
        });

        // Извлечение других данных объявления
        const html = await page.content();
        const $ = cheerio.load(html);
        const title = $('h1').text().trim();
        const parts = title.split(',');
        const address = parts.length > 1 ? parts[parts.length - 1].trim() : null; // Адрес — это последняя часть
        const duration = /посуточно/i.test(title) ? 'daily_rent' : 'long_time';
        const priceString = $('.offer__price').text().trim().replace(/\s+/g, ' ').replace(' 〒 / месяц', '');
        const price = parseInt(priceString.replace(/\D/g, ''), 10);
        const rooms = title.charAt(0);
        const location = $('.offer__location').text().trim().replace(/\n\s*показать на карте$/, '');
        const city = location.split(',')[0].trim();
        const district = location.split(',')[1].trim();
        const floorElement = $('div.offer__info-item[data-name="flat.floor"] .offer__advert-short-info').text().trim();
        const floorMatch = floorElement.match(/(\d+)\sиз\s(\d+)/);
        const floor = floorMatch ? { current: floorMatch[1], total: floorMatch[2] } : null;
        const areaElement = $('div.offer__info-item[data-name="live.square"] .offer__advert-short-info').text().trim();
        const areaMatch = areaElement.match(/(\d+)\sм²/);
        const area = areaMatch ? parseInt(areaMatch[1], 10) : null;
        const condition = await page.evaluate(() => {
            const text = document.querySelector('div.offer__info-item[data-name="flat.renovation"] .offer__advert-short-info, div.offer__info-item[data-name="flat.rent_renovation"] .offer__advert-short-info');
            return text ? text.textContent.trim() : null;
        });
        const author = $('.owners__name').text().trim();
        const description = $('.js-description').text().trim();

        // Дополнительные параметры
        const furniture = $('dt[data-name="flat.furniture"]').next().text().trim();
        const facilities = $('dt[data-name="flat.facilities"]').next().text().trim();
        const toilet = $('dt[data-name="separated_toilet"]').next().text().trim();
        const bathroom = $('dt[data-name="bathroom"]').next().text().trim();
        const rentalOptions = $('dt[data-name="who_match"]').next().text().trim();
        const adIdMatch = adUrl.match(/\/show\/(\d+)/);
        const adId = adIdMatch ? adIdMatch[1] : null;

        // Извлечение даты объявления
        const postedAtText = await page.evaluate(() => {
            const text = document.querySelector('.a-nb-views-text.is-updated')?.textContent.trim();
            return text ? text.split(/\s+/).slice(-2).join(' ') : null;
        });
        const postedAt = postedAtText ? moment(postedAtText, 'D MMMM', 'ru', true).format('YYYY-MM-DD') : null;

        // Сбор ссылок на фотографии
        const photos = [];
        const imgSrc = $('body > main > div.layout__container.a-item > div > div.offer__container > div.offer__content > div.gallery__container > div > a > picture > img').attr('src');

        if (!imgSrc) {
            console.log('Изображение не найдено.');
            return;
        } else {
            // Базовый URL и часть пути
            const baseUrl = 'https://alaps-photos-kr.kcdn.kz/webp/';
            const pathPart = imgSrc.split('/').slice(4, 6).join('/'); // Получаем часть пути, например "14/14f77fad-bcd9-42e3-8a54-9b33295682a1"

            // Извлечение порядкового номера из текущего изображения
            const currentNumberMatch = imgSrc.match(/\/(\d+)-750x470\.jpg$/);
            let startNumber = 1; // Значение по умолчанию, если не удалось найти номер

            if (currentNumberMatch) {
                startNumber = parseInt(currentNumberMatch[1], 10);
            }

            // Генерация и проверка URL
            let i = startNumber;
            let morePhotos = true;

            while (morePhotos && photos.length < 10) { // Количество извлекаемых фотографий
                // Генерация URL
                const fullUrl = `${baseUrl}${pathPart}/${i}-full.webp`;
                if (await checkUrl(fullUrl)) {
                    photos.push(fullUrl);
                    i++;
                } else {
                    morePhotos = false;
                }
            }

            async function checkUrl(url) {
                try {
                    const response = await axios.head(url);
                    return response.status === 200;
                } catch {
                    return false;
                }
            }
        }

        return {
            adId,  // ID объявления
            adUrl, // Ссылка на объявление
            title,
            address,
            rooms,
            price,
            city,
            district,
            duration,
            floor,
            area,
            condition,
            phone,
            author,
            description,
            furniture,
            facilities,
            toilet: toilet === 'совмещен' ? 'совмещенный санузел' : 'раздельный санузел',
            bathroom,
            rentalOptions,
            photos,
            postedAt,
            promotions: [],
            source: "parser",
            adType: "rentOut",
            houseType: config.params.space === 'kvartiry' ? 'apartment' : ''
        };
    } catch (err) {
        logToFile(`Ошибка при парсинге данных: ${err}`);
    } finally {
        await browser.close();
    }
}

// Функция для сохранения данных в JSON
function saveDataToJson(data, filename) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Данные сохранены в файл: ${filename}`);
    } catch (error) {
        console.error(`Ошибка при сохранении данных в файл: ${filename}`, error);
    }
}

// Главная функция для парсинга страниц и объявлений
async function scrapeAds() {
    const cities = config.params.cities;
    let adsData = [];

    for (const city of cities) {
        console.log(`Начинаем парсинг для города: ${city}`);
        let page = 1;
        let hasMorePages = true;
        let adsCollected = 0;

        while (hasMorePages && adsCollected < config.max_ads_per_city) {
            const searchUrl = buildSearchUrl(config, page, city);
            console.log(`Парсинг страницы: ${searchUrl}`);

            const pageContent = await fetchPageWithRetry(searchUrl);
            if (!pageContent) {
                hasMorePages = false;
                break;
            }

            const adLinks = await parseAdLinks(pageContent);

            if (adLinks.length === 0) {
                hasMorePages = false;
                break;
            }

            for (const { url: adUrl, promotions } of adLinks) {
                console.log(`Парсинг объявления: ${adUrl}`);

                // Извлечение ID объявления из URL
                const adIdMatch = adUrl.match(/\/show\/(\d+)/);
                const adId = adIdMatch ? adIdMatch[1] : null;

                if (adId && await DB.checkAdExists(adId)) {
                    console.log(`Объявление с ID ${adId} уже существует в базе данных.`);
                    continue; // Переходим к следующему объявлению
                }

                const adDetails = await parseAdDetailsWithPhonePuppeteer(adUrl);
                if (adDetails) {
                    adDetails.promotions = promotions; // Добавляем параметры продвижения к деталям объявления

                    // Сохранение объявления в базу данных
                    try {
                        await DB.saveAdToDatabase(adDetails);
                        adsData.push(adDetails); // Массив для дальнейшего использования (если нужно)
                        adsCollected++;
                    } catch (err) {
                        logToFile(`Ошибка при сохранении объявления ${err}:`);
                        console.error(`Ошибка при сохранении объявления ${adUrl}:`, err);
                    }

                    if (adsCollected >= config.max_ads_per_city) {
                        hasMorePages = false;
                        break;
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));  // Добавляем паузу между запросами
            }

            page++;
        }

        console.log(`Для города ${city} собрано ${adsCollected} объявлений.`);
    }

    console.log(`${adsData.length} объявлений успешно обработано и сохранено в базу данных.`);
    logToFile(`${adsData.length} объявлений успешно обработано и сохранено в базу данных.`)

    //return adsData.length > 0;
}

//scrapeAds();

module.exports = { scrapeAds };