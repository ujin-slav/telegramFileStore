const TelegramBot = require('node-telegram-bot-api');

// Ваш токен от BotFather
const token = '';

// Создаём экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// ID группы, куда будем отправлять сообщение
// Как узнать ID группы — см. раздел ниже
const chatId = ''; // замените на реальный ID

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