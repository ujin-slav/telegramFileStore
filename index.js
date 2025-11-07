const TelegramBot = require('node-telegram-bot-api');

// Ваш токен от BotFather
const token = '7595878071:AAExDmqJ0a7mewi3kI7TS3WfUzMMxmN_w5A';

// Создаём экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// ID группы, куда будем отправлять сообщение
// Как узнать ID группы — см. раздел ниже
const chatId = '-5049606407'; // замените на реальный ID

// Функция для отправки сообщения
const sendMessageToGroup = async () => {
  try {
    await bot.sendDocument(chatId, 'fuse_python-1.0.9.tar.gz')
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
  }
};

// Вызываем функцию
sendMessageToGroup();