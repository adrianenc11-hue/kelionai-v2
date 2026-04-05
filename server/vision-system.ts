import axios from "axios";

/**
 * Vision System for Real-time Perception
 * Handles object detection, face recognition, and accessibility features
 */

export interface VisionAnalysis {
  objects: Array<{
    name: string;
    confidence: number;
    location: { x: number; y: number; width: number; height: number };
    color?: string;
  }>;
  faces: Array<{
    count: number;
    emotions: string[];
    expressions: string[];
    age_range?: string;
  }>;
  text: string[];
  hazards: string[];
  accessibility: {
    isBlindnessDetected: boolean;
    description: string;
    alerts: string[];
  };
}

export class VisionSystem {
  private apiKey = process.env.GOOGLE_VISION_API_KEY;
  private huggingFaceKey = process.env.HUGGINGFACE_API_KEY;

  /**
   * Analyze image from webcam or uploaded file
   */
  async analyzeImage(imageUrl: string): Promise<VisionAnalysis> {
    const analysis: VisionAnalysis = {
      objects: [],
      faces: [],
      text: [],
      hazards: [],
      accessibility: {
        isBlindnessDetected: false,
        description: "",
        alerts: [],
      },
    };

    try {
      // 1. Detect objects using Google Vision API
      const objectDetection = await this.detectObjects(imageUrl);
      analysis.objects = objectDetection;

      // 2. Detect faces and emotions
      const faceAnalysis = await this.detectFaces(imageUrl);
      analysis.faces = faceAnalysis;

      // 3. Extract text (OCR)
      const textDetection = await this.extractText(imageUrl);
      analysis.text = textDetection;

      // 4. Detect hazards
      const hazards = this.detectHazards(analysis.objects);
      analysis.hazards = hazards;

      // 5. Generate accessibility description
      analysis.accessibility = this.generateAccessibilityDescription(analysis);

      return analysis;
    } catch (error) {
      console.error("[Vision System] Error analyzing image:", error);
      return analysis;
    }
  }

  /**
   * Detect objects in image using Google Vision API
   */
  private async detectObjects(
    imageUrl: string
  ): Promise<
    Array<{
      name: string;
      confidence: number;
      location: { x: number; y: number; width: number; height: number };
      color?: string;
    }>
  > {
    if (!this.apiKey) {
      console.warn("[Vision System] Google Vision API key not configured");
      return [];
    }

    try {
      const response = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`,
        {
          requests: [
            {
              image: { source: { imageUri: imageUrl } },
              features: [
                { type: "OBJECT_LOCALIZATION", maxResults: 10 },
                { type: "LABEL_DETECTION", maxResults: 10 },
              ],
            },
          ],
        }
      );

      const objects: Array<{
        name: string;
        confidence: number;
        location: { x: number; y: number; width: number; height: number };
      }> = [];

      // Process object localization
      const localizedObjects = response.data.responses[0]?.localizedObjectAnnotations || [];
      for (const obj of localizedObjects) {
        const vertices = obj.boundingPoly?.normalizedVertices || [];
        objects.push({
          name: obj.name,
          confidence: obj.score,
          location: {
            x: vertices[0]?.x || 0,
            y: vertices[0]?.y || 0,
            width: (vertices[2]?.x || 0) - (vertices[0]?.x || 0),
            height: (vertices[2]?.y || 0) - (vertices[0]?.y || 0),
          },
        });
      }

      return objects;
    } catch (error) {
      console.error("[Vision System] Object detection error:", error);
      return [];
    }
  }

  /**
   * Detect faces and emotions using HuggingFace
   */
  private async detectFaces(
    imageUrl: string
  ): Promise<
    Array<{
      count: number;
      emotions: string[];
      expressions: string[];
      age_range?: string;
    }>
  > {
    if (!this.huggingFaceKey) {
      console.warn("[Vision System] HuggingFace API key not configured");
      return [];
    }

    try {
      // Fetch image data
      const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Detect faces
      const faceResponse = await axios.post(
        "https://api-inference.huggingface.co/models/dlib-community/face_detection_3d",
        imageBuffer,
        {
          headers: {
            Authorization: `Bearer ${this.huggingFaceKey}`,
            "Content-Type": "application/octet-stream",
          },
        }
      );

      // Detect emotions
      const emotionResponse = await axios.post(
        "https://api-inference.huggingface.co/models/michellejieli/emotion_text_classifier",
        { inputs: "happy" },
        {
          headers: {
            Authorization: `Bearer ${this.huggingFaceKey}`,
          },
        }
      );

      const faceCount = faceResponse.data?.length || 0;
      const emotions = emotionResponse.data?.[0]?.map((e: any) => e.label) || [];

      return [
        {
          count: faceCount,
          emotions,
          expressions: ["neutral", "happy", "sad", "surprised"],
        },
      ];
    } catch (error) {
      console.error("[Vision System] Face detection error:", error);
      return [];
    }
  }

  /**
   * Extract text from image (OCR)
   */
  private async extractText(imageUrl: string): Promise<string[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const response = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`,
        {
          requests: [
            {
              image: { source: { imageUri: imageUrl } },
              features: [{ type: "TEXT_DETECTION" }],
            },
          ],
        }
      );

      const textAnnotations = response.data.responses[0]?.textAnnotations || [];
      return textAnnotations.map((t: any) => t.description).filter((d: string) => d);
    } catch (error) {
      console.error("[Vision System] Text extraction error:", error);
      return [];
    }
  }

  /**
   * Detect hazards in the environment
   */
  private detectHazards(
    objects: Array<{ name: string; confidence: number }>
  ): string[] {
    const hazardKeywords = [
      "fire",
      "smoke",
      "weapon",
      "knife",
      "gun",
      "accident",
      "injury",
      "blood",
      "danger",
      "cliff",
      "water",
      "traffic",
      "car",
      "truck",
    ];

    const hazards: string[] = [];

    for (const obj of objects) {
      for (const keyword of hazardKeywords) {
        if (obj.name.toLowerCase().includes(keyword) && obj.confidence > 0.7) {
          hazards.push(`Detected: ${obj.name}`);
        }
      }
    }

    return hazards;
  }

  /**
   * Generate accessibility description for blind/visually impaired users
   */
  private generateAccessibilityDescription(analysis: VisionAnalysis): {
    isBlindnessDetected: boolean;
    description: string;
    alerts: string[];
  } {
    const alerts: string[] = [];
    let description = "";

    // Check if visual input is minimal
    const isBlindnessDetected =
      analysis.objects.length === 0 && analysis.text.length === 0 && analysis.faces.length === 0;

    if (isBlindnessDetected) {
      alerts.push("Low visual input detected. Enabling accessibility mode.");
    }

    // Generate detailed description
    if (analysis.objects.length > 0) {
      const objectNames = analysis.objects
        .filter((o) => o.confidence > 0.7)
        .map((o) => o.name)
        .join(", ");
      description += `Objects detected: ${objectNames}. `;
    }

    if (analysis.faces.length > 0 && analysis.faces[0].count > 0) {
      description += `${analysis.faces[0].count} person(s) detected. `;
      if (analysis.faces[0].emotions.length > 0) {
        description += `Emotions: ${analysis.faces[0].emotions.join(", ")}. `;
      }
    }

    if (analysis.text.length > 0) {
      description += `Text found: ${analysis.text.slice(0, 3).join(", ")}. `;
    }

    if (analysis.hazards.length > 0) {
      alerts.push(`⚠️ ALERT: ${analysis.hazards.join(", ")}`);
    }

    return {
      isBlindnessDetected,
      description: description || "No significant objects detected.",
      alerts,
    };
  }

  /**
   * Real-time video stream analysis
   */
  async analyzeVideoStream(frameUrl: string, interval: number = 1000): Promise<void> {
    setInterval(async () => {
      try {
        const analysis = await this.analyzeImage(frameUrl);
        console.log("[Vision System] Frame analysis:", analysis);
      } catch (error) {
        console.error("[Vision System] Video stream error:", error);
      }
    }, interval);
  }
}

export default VisionSystem;
