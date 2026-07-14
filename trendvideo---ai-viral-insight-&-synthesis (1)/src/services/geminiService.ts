import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TrendingItem {
  id: string;
  title: string;
  platform: string;
  hotness: number; // 0-100
  url: string;
  image: string;
  description: string;
  category?: string;
  aiComment?: string;
  viralFactors?: string[];
}

export async function searchTrends(keyword: string, platforms: string[], count: number = 50): Promise<TrendingItem[]> {
  const prompt = `Search for the most trending and viral content/videos related to "${keyword}" on these platforms: ${platforms.join(", ")}.
  Focus on the last 24-48 hours.
  Return a list of approximately ${count} items. 
  For each item, provide: title, platform, hotness (0-100), a descriptive URL, a high-quality placeholder image URL (related to the topic), and a short description.
  You MUST use your internal tools if needed to find current information.
  Return the result as a JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              platform: { type: Type.STRING },
              hotness: { type: Type.NUMBER },
              url: { type: Type.STRING },
              image: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ["title", "platform", "hotness", "url", "image", "description"],
          },
        },
        tools: [{ googleSearch: {} }] as any, // Enabling search for real discovery
      },
    });

    const results = JSON.parse(response.text || "[]");
    return results.map((item: any, index: number) => ({
      ...item,
      id: `trend_${Date.now()}_${index}`,
    }));
  } catch (error) {
    console.error("Search trends error:", error);
    return [];
  }
}

export async function analyzeTrends(items: TrendingItem[]): Promise<TrendingItem[]> {
  const prompt = `Analyze the following viral trends and provide:
  1. Smart classification (e.g., Tech, Entertainment, News).
  2. Viral factor analysis (Why is this trending?).
  3. A catchy AI recommendation/summary (1 sentence).
  
  Input Data: ${JSON.stringify(items.map(i => ({ title: i.title, description: i.description })))}
  
  Return the original items updated with these new fields: category, aiComment, viralFactors (array of strings).
  Return as a JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              aiComment: { type: Type.STRING },
              viralFactors: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
            },
            required: ["category", "aiComment", "viralFactors"],
          },
        },
      },
    });

    const analysis = JSON.parse(response.text || "[]");
    return items.map((item, index) => ({
      ...item,
      ...analysis[index],
    }));
  } catch (error) {
    console.error("Analyze trends error:", error);
    return items;
  }
}

export async function extractVideoInsights(item: TrendingItem): Promise<{ summary: string; script: string; pptStructure: any[] }> {
  const prompt = `你是一个专业的短视频分析专家。针对这个热门内容 "${item.title}" (${item.description})，请完成以下任务：
  1. 总结其为什么能火（爆款逻辑，保持在 200 字以内）。
  2. 提炼其核心文案/脚本（保持精炼）。
  3. 生成一个 5 页的 PPT 提纲（标题、内容要点，每页内容不超过 3 条）。
  
  必须严格按 JSON 格式返回，不要包含任何额外的描述性文字。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            script: { type: Type.STRING },
            pptStructure: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["title", "content"]
              }
            }
          },
          required: ["summary", "script", "pptStructure"]
        }
      },
    });

    let text = response.text || "{}";
    // Clean up potential markdown formatting if model ignores responseMimeType
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Extraction error:", error);
    return { 
      summary: "暂时无法通过 AI 提取深度逻辑，可能是内容过于新颖或受到保护。", 
      script: "文案提取失败", 
      pptStructure: [
        { title: "封面", content: ["标题：" + item.title] },
        { title: "背景", content: [item.description] }
      ] 
    };
  }
}
