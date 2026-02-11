
import { GoogleGenAI, Type } from "@google/genai";
// 确保读取到 Vite 注入的环境变量
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
export const processAcousticCommand = async (command: string) => {
  const prompt = `分析以下关于声学方案的需求描述，并提取参数: "${command}"`;
  
  // 打印发出的原始消息
  console.log("%c[AI Request Send]", "color: #6366f1; font-weight: bold", {
    originalCommand: command,
    fullPrompt: prompt
  });

  try {
    // Using gemini-3-pro-preview for complex parameter extraction task
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scenario: { type: Type.STRING, description: "MEETING_ROOM or LECTURE_HALL" },
            length: { type: Type.NUMBER },
            width: { type: Type.NUMBER },
            height: { type: Type.NUMBER },
            stageToNearAudience: { type: Type.NUMBER },
            stageToFarAudience: { type: Type.NUMBER },
            stageWidth: { type: Type.NUMBER },
            stageDepth: { type: Type.NUMBER },
            hasCentralControl: { type: Type.BOOLEAN },
            hasMatrix: { type: Type.BOOLEAN },
            hasVideoConf: { type: Type.BOOLEAN },
            hasRecording: { type: Type.BOOLEAN },
            suggestedMics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  count: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    });

    // Directly accessing .text property of GenerateContentResponse
    const result = JSON.parse(response.text || '{}');
    
    // 打印 AI 返回的结构化数据
    console.log("%c[AI Response Received]", "color: #10b981; font-weight: bold", result);
    
    return result;
  } catch (error) {
    console.error("%c[AI Error]", "color: #ef4444; font-weight: bold", error);
    return null;
  }
};
