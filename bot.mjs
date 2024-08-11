import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

bot.on('photo', async (ctx) => {
  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Download the image
    const imageResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');

    // Upload the file to Google's servers
    const uploadResult = await fileManager.uploadFile(imageBuffer, {
      mimeType: 'image/jpeg',
      displayName: `TelegramImage_${Date.now()}.jpg`,
    });

    console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri}`);

    // Use Gemini to analyze the image
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

    // Send the analysis back to the user in Markdown format
    await ctx.replyWithMarkdown(`*Image Analysis:*\n\n${markdown}`);
  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('Sorry, there was an error processing your image.');
  }
});

export default async function handler(req, res) {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error in webhook handler:', error);
    res.status(500).send('Internal Server Error');
  }
}