import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import crypto from 'crypto';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
  throw new Error('TELEGRAM_BOT_TOKEN или GEMINI_API_KEY не установлены в переменных окружения');
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const logger = {
  info: (message, ...args) => console.log(`[ИНФО] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[ПРЕДУПРЕЖДЕНИЕ] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ОШИБКА] ${message}`, ...args),
};

const analysisCache = new Map();

function markdownToTelegramHTML(markdown) {
  let html = markdown;

  // Замена заголовков
  html = html.replace(/^### (.*$)/gim, '<b>$1</b>');
  html = html.replace(/^## (.*$)/gim, '<b>$1</b>');
  html = html.replace(/^# (.*$)/gim, '<b>$1</b>');

  // Замена жирного текста и курсива
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');

  // Замена списков
  html = html.replace(/^\s*[-*] (.*)$/gm, '• $1');

  // Замена ссылок
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

  // Замена кода
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');

  return html;
}

async function checkImageType(imageBuffer) {
  const signature = imageBuffer.toString('hex', 0, 4);
  const signatures = {
    'ffd8ffe0': 'image/jpeg',
    'ffd8ffe1': 'image/jpeg',
    '89504e47': 'image/png',
    '47494638': 'image/gif',
  };
  return signatures[signature] || 'unknown';
}

async function analyzeImage(imageBuffer, chatId) {
  try {
    const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
    if (analysisCache.has(imageHash)) {
      logger.info('Используется кэшированный анализ');
      return analysisCache.get(imageHash);
    }

    const model = genAI.getGenerativeModel({
      generationConfig: {
        temperature: 0,
      },
      model: 'gemini-1.5-flash'
    });

    const prompt = `Проанализируйте это изображение и предоставьте подробное описание на русском языке. 
    Используйте следующую структуру и Markdown для форматирования:

    ### 📸 Основное содержание:
    * Опишите главные объекты или субъекты
    * Укажите основные цвета и визуальные элементы

    ### 🔍 Детали:
    * Опишите любой видимый текст на изображении
    * Укажите на интересные или необычные детали

    ### 🌍 Контекст:
    * Предположите возможный контекст или обстановку
    * Опишите настроение или атмосферу изображения

    ### 💡 Интересный факт:
    * Добавьте один интересный факт или наблюдение, связанное с содержанием изображения

    Используйте **жирный текст** для выделения важных деталей. Будьте кратки, но информативны.`;

    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/jpeg'
        }
      },
      { text: prompt },
    ]);

    if (!result.response) {
      throw new Error('Нет ответа от API Gemini');
    }

    const markdownAnalysis = result.response.text();
    const htmlAnalysis = markdownToTelegramHTML(markdownAnalysis);

    analysisCache.set(imageHash, htmlAnalysis);
    return htmlAnalysis;
  } catch (error) {
    logger.error('Ошибка при анализе изображения:', error);
    throw new Error(`Не удалось проанализировать изображение: ${error.message}`);
  }
}

async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);

    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    if (imageBuffer.length > MAX_FILE_SIZE) {
      throw new Error(`Размер изображения (${imageBuffer.length} байт) превышает максимально допустимый размер`);
    }

    const imageType = await checkImageType(imageBuffer);
    if (imageType === 'unknown') {
      throw new Error('Неподдерживаемый формат изображения. Пожалуйста, отправьте изображение в формате JPEG, PNG или GIF.');
    }

    await bot.sendMessage(chatId, "Я анализирую ваше изображение. Это может занять некоторое время...");
    const analysis = await analyzeImage(imageBuffer, chatId);
    await bot.sendMessage(chatId, analysis, { parse_mode: 'HTML' });
  } catch (error) {
    logger.error('Ошибка при обработке фото:', error);
    let userMessage = "Извините, но я не смог проанализировать это изображение. ";
    if (error.message.includes('максимально допустимый размер')) {
      userMessage += "Изображение слишком большое. Пожалуйста, попробуйте отправить изображение меньшего размера (до 4МБ).";
    } else if (error.message.includes('Неподдерживаемый формат изображения')) {
      userMessage += error.message;
    } else {
      userMessage += "Произошла непредвиденная ошибка. Пожалуйста, попробуйте еще раз позже или с другим изображением.";
    }
    await bot.sendMessage(chatId, userMessage);
  }
}

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const message = "<b>Привет!</b> Я продвинутый бот для анализа изображений. Отправьте мне изображение, и я предоставлю подробное описание того, что вижу. Вы также можете использовать следующие команды:\n\n" +
                  "/help - Получить инструкции по использованию\n" +
                  "/about - Узнать больше о моих возможностях";
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const message = "<b>Вот как меня использовать:</b>\n\n" +
                  "1. Отправьте мне любое изображение (JPEG, PNG или GIF)\n" +
                  "2. Я проанализирую его и предоставлю подробное описание\n" +
                  "3. Анализ может занять несколько секунд\n\n" +
                  "<b>Советы:</b>\n" +
                  "• Размер изображений должен быть менее 4МБ\n" +
                  "• Четкие, хорошо освещенные изображения дают лучшие результаты\n" +
                  "• Я могу идентифицировать объекты, сцены, цвета, текст и многое другое\n" +
                  "• Для наилучших результатов отправляйте изображения с интересным содержанием или сценами";
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

async function handleAbout(msg) {
  const chatId = msg.chat.id;
  const message = "<b>Я бот для анализа изображений</b>, работающий на основе искусственного интеллекта и использующий продвинутое машинное обучение для описания содержимого изображений. " +
                  "Мои возможности включают:\n\n" +
                  "• Распознавание объектов и сцен\n" +
                  "• Анализ цветов и визуальных элементов\n" +
                  "• Обнаружение текста на изображениях\n" +
                  "• Интерпретацию настроения и атмосферы\n" +
                  "• Понимание контекста и обстановки на изображениях\n\n" +
                  "Я работаю на базе <i>Google Gemini AI</i> и постоянно учусь и совершенствуюсь!";
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

export default async function handler(req, res) {
  try {
    const { body } = req;
    if (body.message) {
      if (body.message.photo) {
        await handlePhoto(body.message);
      } else if (body.message.text) {
        const text = body.message.text.toLowerCase();
        if (text === '/start') {
          await handleStart(body.message);
        } else if (text === '/help') {
          await handleHelp(body.message);
        } else if (text === '/about') {
          await handleAbout(body.message);
        } else {
          await bot.sendMessage(body.message.chat.id, "Пожалуйста, отправьте мне изображение для анализа или используйте /help для получения дополнительной информации.");
        }
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Ошибка в обработчике вебхука:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

// Только для локального тестирования
if (process.env.NODE_ENV === 'development') {
  import('express').then((express) => {
    const app = express.default();
    app.use(express.json());
    const PORT = process.env.PORT || 3000;

    app.post('/webhook', handler);

    app.listen(PORT, () => {
      logger.info(`Локальный сервер запущен на порту ${PORT}`);
      logger.info(`URL вебхука: http://localhost:${PORT}/webhook`);
    });
  });
}

logger.info('Обработчик продвинутого бота инициализирован');