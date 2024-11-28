const cron = require('node-cron');
const parser = require('./parser');
const watermarkremover = require('../watermark_remover/index');

// Ежедневный запуск в 01:00
cron.schedule('10 0 * * *', async () => {
    console.log('Запуск парсинга объявлений...');

    try {
        await parser.scrapeAds();
        console.log('Запуск удаления вотермарков...');
        await watermarkremover.processPhotos();
    } catch (error) {
        console.error('Ошибка во время парсинга или удаления водяных знаков:', error);
    }
});