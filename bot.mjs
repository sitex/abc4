import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  console.log('Received photo message');
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    console.log('File ID:', fileId);
    const fileLink = await bot.getFileLink(fileId);
    console.log('File Link:', fileLink);

    // Download the image
    console.log('Downloading image...');
    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    console.log('Image downloaded');

    // Upload the file to Google's servers
    console.log('Uploading to Google servers...');
    const uploadResult = await fileManager.uploadFile(imageBuffer, {
      mimeType: 'image/jpeg',
      displayName: `TelegramImage_${Date.now()}.jpg`,
    });
    console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri}`);

    // Use Gemini to analyze the image
    console.log('Analyzing image with Gemini...');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-vision' });

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: uploadResult.file.mimeType,
          fileUri: uploadResult.file.uri
        }
      },
      { text: "Analyze this image and describe what you see. Provide your analysis in Markdown format, using appropriate headers, lists, and emphasis where relevant." },
    ]);

    const generatedResponse = await result.response;
    const markdown = generatedResponse.text();
    console.log('Analysis complete');

    // Send the analysis back to the user in Markdown format
    console.log('Sending response to user...');
    await bot.sendMessage(chatId, markdown, { parse_mode: 'Markdown' });
    console.log('Response sent');
  } catch (error) {
    console.error('Error:', error);
    await bot.sendMessage(chatId, 'Sorry, there was an error processing your image.');
  }
}

export default async function handler(req, res) {
  console.log('Webhook handler called');
  try {
    const { body } = req;
    if (body.message && body.message.photo) {
      await handlePhoto(body.message);
    } else if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      console.log('Received text message:', body.message.text);
      await bot.sendMessage(chatId, 'I received your message. Please send me an image to analyze.');
    }
    res.status(200).send('OK');
    console.log('Update handled successfully');
  } catch (error) {
    console.error('Error in webhook handler:', error);
    res.status(500).send('Internal Server Error');
  }
}

console.log('Bot handler initialized');