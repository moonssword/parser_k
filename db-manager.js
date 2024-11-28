const pool = require('./pg_config');
require('dotenv').config();

// Функция для сохранения данных объявления в базу данных
async function saveAdToDatabase(adData) {
    const {
        adId, adUrl, title, address, price, city, district, floor, area, duration, condition,
        phone, author, description, furniture, facilities, toilet,
        bathroom, rentalOptions, rooms, postedAt, photos, promotions,
        source, adType, houseType
    } = adData;

    const query = `
        INSERT INTO ads (
            ad_id, ad_url, title, address, price, rooms, city, district, floor_current, floor_total, duration,
            area, condition, phone, author, description, furniture,
            facilities, toilet, bathroom, rental_options, posted_at, photos, promotions, source, ad_type, house_type
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
        )
        ON CONFLICT (ad_id) DO NOTHING;
    `;

    const jsonPhotos = Array.isArray(photos) ? JSON.stringify(photos) : '[]';
    const jsonPromotions = Array.isArray(promotions) ? JSON.stringify(promotions) : '[]';

    const values = [
        adId, adUrl, title, address, price, rooms, city, district, floor?.current, floor?.total, duration, area, condition,
        phone, author, description, furniture, facilities, toilet, bathroom, rentalOptions, postedAt, jsonPhotos || [], jsonPromotions,
        source, adType, houseType
    ];

    try {
        await pool.query(query, values);
        console.log(`Объявление с ID ${adId} успешно сохранено.`);
    } catch (err) {
        console.error('Ошибка при сохранении объявления в базу данных:', err);
        throw err;
    }
}

// Функция для проверки существования объявления в базе данных
async function checkAdExists(adId) {
    const query = 'SELECT 1 FROM ads WHERE ad_id = $1 LIMIT 1;';
    try {
        const result = await pool.query(query, [adId]);
        return result.rowCount > 0;
    } catch (err) {
        console.error('Ошибка при проверке существования объявления:', err);
        throw err;
    } finally {
        //pool.end();
    }
}

module.exports = { saveAdToDatabase, checkAdExists };
