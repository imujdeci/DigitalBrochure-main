import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  loginSchema,
  insertCampaignSchema,
  insertCampaignProductSchema,
  type Product,
} from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { unlink } from "fs/promises";

// Configure multer for file uploads - use persistent directory
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create public/assets directory for persistent storage
const publicAssetsDir = path.join(process.cwd(), "public", "assets");
if (!fs.existsSync(publicAssetsDir)) {
  fs.mkdirSync(publicAssetsDir, { recursive: true });
}

// JSON files for persistent metadata
const productsJsonPath = path.join(publicAssetsDir, "products.json");
const logosJsonPath = path.join(publicAssetsDir, "logos.json");
const templatesJsonPath = path.join(publicAssetsDir, "templates.json");

async function ensureJson(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch {
    await fs.promises.writeFile(filePath, JSON.stringify([], null, 2), "utf-8");
  }
}

async function readJsonArray<T = any>(filePath: string): Promise<T[]> {
  await ensureJson(filePath);
  const data = await fs.promises.readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray(filePath: string, arr: any[]): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(arr, null, 2), "utf-8");
}

function nextId(items: { id?: number }[]): number {
  // Normalize all IDs to numbers and find the maximum
  const ids = items
    .map((item) => {
      const id = item.id;
      return typeof id === "string" ? parseInt(id, 10) : Number(id) || 0;
    })
    .filter((id) => !isNaN(id) && id > 0);

  const maxId = ids.length > 0 ? Math.max(...ids) : 0;
  return maxId + 1;
}

function ensureUniqueId(productsArr: any[], newId: number): number {
  // Normalize all IDs to numbers
  const normalizedIds = productsArr
    .map((p) => {
      const id = p.id;
      return typeof id === "string" ? parseInt(id, 10) : Number(id) || 0;
    })
    .filter((id) => !isNaN(id) && id > 0);

  // Check if ID already exists, if so find next available
  let candidateId = newId;
  const usedIds = new Set(normalizedIds);

  // Keep incrementing until we find an unused ID
  while (usedIds.has(candidateId)) {
    candidateId++;
  }

  return candidateId;
}

function removeDuplicateIds(productsArr: any[]): any[] {
  const seen = new Set<number>();
  const cleaned: any[] = [];
  const duplicates: any[] = [];

  for (const product of productsArr) {
    const id =
      typeof product.id === "string"
        ? parseInt(product.id, 10)
        : Number(product.id) || 0;

    if (id > 0 && !isNaN(id)) {
      if (seen.has(id)) {
        // Duplicate found, assign new ID
        const newId = nextId(cleaned);
        duplicates.push({ oldId: id, newId, product });
        cleaned.push({ ...product, id: newId });
        seen.add(newId);
      } else {
        cleaned.push(product);
        seen.add(id);
      }
    } else {
      // Invalid ID, assign new one
      const newId = nextId(cleaned);
      cleaned.push({ ...product, id: newId });
      seen.add(newId);
    }
  }

  if (duplicates.length > 0) {
    console.log("Removed duplicate IDs:", duplicates);
  }

  return cleaned;
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// Helper function to sanitize filename
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()
    .substring(0, 50);
}

// Helper function to copy file to public/assets with custom name
async function copyToPublicAssets(
  sourcePath: string,
  customName: string,
  originalExtension: string
): Promise<string> {
  const timestamp = Date.now();
  const sanitizedName = sanitizeFilename(customName);
  const fileName = `${sanitizedName}_${timestamp}${originalExtension}`;
  const destPath = path.join(publicAssetsDir, fileName);

  await fs.promises.copyFile(sourcePath, destPath);
  return `/public/assets/${fileName}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve uploaded files statically
  app.use("/uploads", express.static(uploadDir));
  // Serve public assets statically
  app.use("/public/assets", express.static(publicAssetsDir));

  // Authentication
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(username);

      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      res.json({
        user: { id: user.id, username: user.username, name: user.name },
      });
    } catch (error) {
      res.status(400).json({ message: "Invalid request data" });
    }
  });

  // Campaigns
  app.get("/api/campaigns", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const campaigns = await storage.getCampaigns(userId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id);

      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      res.json(campaign);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch campaign" });
    }
  });

  app.post("/api/campaigns", async (req, res) => {
    try {
      const campaignData = insertCampaignSchema.parse(req.body);
      const campaign = await storage.createCampaign(campaignData);
      res.status(201).json(campaign);
    } catch (error) {
      res.status(400).json({ message: "Invalid campaign data" });
    }
  });

  app.put("/api/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

      const campaign = await storage.updateCampaign(id, updates);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      res.json(campaign);
    } catch (error) {
      res.status(500).json({ message: "Failed to update campaign" });
    }
  });

  app.delete("/api/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteCampaign(id);

      if (!deleted) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      res.json({ message: "Campaign deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete campaign" });
    }
  });

  // Products
  app.get("/api/products", async (req, res) => {
    try {
      const search = (req.query.search as string) || "";
      const category = (req.query.category as string) || "";

      let jsonProducts = await readJsonArray<any>(productsJsonPath);

      // Clean duplicate IDs before returning
      jsonProducts = removeDuplicateIds(jsonProducts);
      if (
        jsonProducts.length !==
        (await readJsonArray<any>(productsJsonPath)).length
      ) {
        await writeJsonArray(productsJsonPath, jsonProducts);
        console.log("GET /api/products - Cleaned duplicate IDs");
      }

      let products = jsonProducts;
      if (search) {
        const s = search.toLowerCase();
        products = products.filter(
          (p) =>
            p.name?.toLowerCase().includes(s) ||
            p.description?.toLowerCase().includes(s)
        );
      }
      if (category && category !== "all") {
        products = products.filter((p) => p.category === category);
      }

      // Fallback to in-memory storage if JSON empty
      if (!products || products.length === 0) {
        const fallback = await storage.getProducts(search, category);
        return res.json(fallback);
      }

      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/products", upload.single("image"), async (req, res) => {
    try {
      const { name, description, originalPrice, category } = req.body;

      let imageUrl = null;
      let publicAssetsUrl = null;

      if (req.file) {
        imageUrl = `/uploads/${req.file.filename}`;
        const fileExtension = path.extname(
          req.file.originalname || req.file.filename
        );
        try {
          publicAssetsUrl = await copyToPublicAssets(
            req.file.path,
            name || "product",
            fileExtension
          );
        } catch (error) {
          console.error(
            "Failed to copy product image to public/assets:",
            error
          );
        }
      }

      const productData = {
        name,
        description: description || null,
        originalPrice: parseFloat(originalPrice),
        category,
        imageUrl: publicAssetsUrl || imageUrl,
      };

      // First, get existing products from JSON to ensure unique ID
      let productsArr = await readJsonArray<any>(productsJsonPath);

      // Clean any existing duplicate IDs first
      productsArr = removeDuplicateIds(productsArr);
      if (productsArr.length > 0) {
        await writeJsonArray(productsJsonPath, productsArr);
        console.log(
          "POST /api/products - Cleaned duplicate IDs in existing products"
        );
      }

      // Generate unique ID based on JSON (primary source)
      const newId = nextId(productsArr);

      // Verify ID is unique (this should always return a unique ID now)
      const uniqueId = ensureUniqueId(productsArr, newId);

      console.log("POST /api/products - Generated unique ID:", uniqueId);
      console.log(
        "POST /api/products - Existing IDs:",
        productsArr.map((p: any) => {
          const id =
            typeof p.id === "string" ? parseInt(p.id, 10) : Number(p.id);
          return { id, name: p.name };
        })
      );

      // Persist to JSON with unique ID first (primary source)
      const record = {
        id: uniqueId,
        ...productData,
      };

      // Final check: ensure no duplicate IDs before adding
      const duplicateCheck = productsArr.find((p: any) => {
        const existingId =
          typeof p.id === "string" ? parseInt(p.id, 10) : Number(p.id);
        return existingId === uniqueId;
      });

      if (duplicateCheck) {
        console.error("POST /api/products - Duplicate ID detected:", uniqueId);
        return res.status(500).json({
          message: "Failed to create product: duplicate ID detected",
        });
      }

      productsArr.push(record);
      await writeJsonArray(productsJsonPath, productsArr);

      // Now sync to memory storage with the same ID
      // We need to manually add to memory since createProduct auto-generates ID
      const memoryProduct: Product = {
        id: uniqueId,
        name: productData.name,
        category: productData.category,
        originalPrice: productData.originalPrice,
        description: productData.description || null,
        imageUrl: productData.imageUrl || null,
      };

      // Manually add to memory storage (bypassing createProduct to use our ID)
      // Update currentProductId to avoid conflicts
      if ((storage as any).currentProductId <= uniqueId) {
        (storage as any).currentProductId = uniqueId + 1;
      }
      (storage as any).products.set(uniqueId, memoryProduct);

      console.log(
        "POST /api/products - Created product with unique ID:",
        uniqueId
      );
      res.status(201).json(record);
    } catch (error) {
      console.error("Product creation error:", error);
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.patch("/api/products/:id", upload.single("image"), async (req, res) => {
    try {
      const idParam = req.params.id;
      const id = parseInt(idParam, 10);

      if (isNaN(id)) {
        console.error(
          "PATCH /api/products/:id - Invalid ID parameter:",
          idParam
        );
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const { name, description, originalPrice, category } = req.body;

      console.log("PATCH /api/products/:id - URL param:", idParam);
      console.log(
        "PATCH /api/products/:id - Parsed ID:",
        id,
        "Type:",
        typeof id
      );
      console.log("PATCH /api/products/:id - Request body:", req.body);
      console.log(
        "PATCH /api/products/:id - File:",
        req.file ? "present" : "not present"
      );

      const updates: any = {};

      // Name: required field, must be provided and not empty
      if (name !== undefined) {
        if (name === null || (typeof name === "string" && name.trim() === "")) {
          return res.status(400).json({ message: "Product name is required" });
        }
        updates.name = typeof name === "string" ? name.trim() : name;
      }

      // Description: optional field, can be empty (null in DB)
      if (description !== undefined) {
        updates.description =
          description &&
          typeof description === "string" &&
          description.trim() !== ""
            ? description.trim()
            : null;
      }

      // Price: required field, must be provided and valid number
      if (originalPrice !== undefined) {
        if (originalPrice === null || originalPrice === "") {
          return res.status(400).json({ message: "Product price is required" });
        }
        const price = parseFloat(originalPrice);
        if (isNaN(price) || price < 0) {
          return res.status(400).json({ message: "Invalid price value" });
        }
        updates.originalPrice = price;
      }

      // Category: required field, must be provided and not empty
      if (category !== undefined) {
        if (
          category === null ||
          (typeof category === "string" && category.trim() === "")
        ) {
          return res
            .status(400)
            .json({ message: "Product category is required" });
        }
        updates.category =
          typeof category === "string" ? category.trim() : category;
      }

      if (req.file) {
        const productName =
          name || (await storage.getProduct(id))?.name || "product";
        const fileExtension = path.extname(
          req.file.originalname || req.file.filename
        );
        try {
          const publicAssetsUrl = await copyToPublicAssets(
            req.file.path,
            productName,
            fileExtension
          );
          updates.imageUrl = publicAssetsUrl;
        } catch (error) {
          console.error(
            "Failed to copy product image to public/assets:",
            error
          );
          updates.imageUrl = `/uploads/${req.file.filename}`;
        }
      }

      console.log("PATCH /api/products/:id - Updates:", updates);

      // Check if there are any updates
      if (Object.keys(updates).length === 0 && !req.file) {
        console.log("PATCH /api/products/:id - No updates provided");
        return res.status(400).json({ message: "No updates provided" });
      }

      // First, check JSON file for the product (primary source)
      let productsArr = await readJsonArray<any>(productsJsonPath);

      // Normalize all IDs to numbers to avoid type mismatch issues
      productsArr = productsArr.map((p: any) => ({
        ...p,
        id: typeof p.id === "string" ? parseInt(p.id, 10) : Number(p.id),
      }));

      // Ensure ID comparison is done with numbers
      const jsonProductIndex = productsArr.findIndex(
        (p) => Number(p.id) === Number(id)
      );

      console.log(
        "PATCH /api/products/:id - Looking for product ID:",
        id,
        typeof id
      );
      console.log(
        "PATCH /api/products/:id - Products in JSON:",
        productsArr.map((p: any) => ({
          id: p.id,
          idType: typeof p.id,
          name: p.name,
        }))
      );
      console.log("PATCH /api/products/:id - Found index:", jsonProductIndex);
      if (jsonProductIndex !== -1) {
        console.log(
          "PATCH /api/products/:id - Found product:",
          productsArr[jsonProductIndex]
        );
      }

      if (jsonProductIndex === -1) {
        // Product not found in JSON, check memory storage
        const memoryProduct = await storage.getProduct(id);
        if (!memoryProduct) {
          console.log(
            "PATCH /api/products/:id - Product not found in JSON or memory"
          );
          return res.status(404).json({ message: "Product not found" });
        }
        // Product exists only in memory, update memory and add to JSON
        const updatedMemoryProduct = await storage.updateProduct(id, updates);
        if (!updatedMemoryProduct) {
          console.log(
            "PATCH /api/products/:id - Failed to update product in memory"
          );
          return res.status(500).json({ message: "Failed to update product" });
        }
        productsArr.push(updatedMemoryProduct);
        await writeJsonArray(productsJsonPath, productsArr);
        console.log(
          "PATCH /api/products/:id - Updated product:",
          updatedMemoryProduct
        );
        return res.json(updatedMemoryProduct);
      }

      // Product exists in JSON, update it
      const existingProduct = productsArr[jsonProductIndex];

      // Verify we're updating the correct product
      const existingProductId = Number(existingProduct.id);
      const requestedId = Number(id);

      if (existingProductId !== requestedId) {
        console.error(
          "PATCH /api/products/:id - ID mismatch! Requested ID:",
          requestedId,
          "Found product ID:",
          existingProductId
        );
        return res.status(400).json({
          message: `ID mismatch: requested ${requestedId} but found ${existingProductId}`,
        });
      }

      console.log(
        "PATCH /api/products/:id - Updating product at index:",
        jsonProductIndex
      );
      console.log(
        "PATCH /api/products/:id - Existing product:",
        existingProduct
      );
      console.log("PATCH /api/products/:id - Updates to apply:", updates);

      const updatedProduct = {
        ...existingProduct,
        ...updates,
        id: existingProductId,
      };
      productsArr[jsonProductIndex] = updatedProduct;
      await writeJsonArray(productsJsonPath, productsArr);

      // Also update memory storage if product exists there
      const memoryProduct = await storage.getProduct(id);
      if (memoryProduct) {
        await storage.updateProduct(id, updates);
      }

      console.log("PATCH /api/products/:id - Updated product:", updatedProduct);
      res.json(updatedProduct);
    } catch (error) {
      console.error("PATCH /api/products/:id - Error:", error);
      res.status(500).json({
        message: "Failed to update product",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // First, get the product to find its image file
      const productsArr = await readJsonArray<any>(productsJsonPath);
      const productIndex = productsArr.findIndex((p) => {
        const productId =
          typeof p.id === "string" ? parseInt(p.id, 10) : Number(p.id);
        return productId === id;
      });

      if (productIndex === -1) {
        // Check memory storage
        const memoryProduct = await storage.getProduct(id);
        if (!memoryProduct) {
          return res.status(404).json({ message: "Product not found" });
        }
      }

      const product =
        productIndex !== -1
          ? productsArr[productIndex]
          : await storage.getProduct(id);

      // Delete image file if it exists
      if (product && product.imageUrl) {
        let imageFileName: string | null = null;

        // Extract filename from imageUrl
        // imageUrl can be: "/public/assets/filename.png" or "/uploads/filename.png"
        if (product.imageUrl.startsWith("/public/assets/")) {
          imageFileName = product.imageUrl.replace("/public/assets/", "");
        } else if (product.imageUrl.startsWith("/uploads/")) {
          imageFileName = product.imageUrl.replace("/uploads/", "");
        } else if (product.imageUrl.includes("/")) {
          // Extract filename from any path
          imageFileName = path.basename(product.imageUrl);
        }

        if (imageFileName) {
          // Delete from public/assets folder
          const publicAssetsPath = path.join(publicAssetsDir, imageFileName);
          try {
            await unlink(publicAssetsPath);
            console.log(
              "Deleted product image from public/assets:",
              imageFileName
            );
          } catch (e: any) {
            // File might not exist, that's okay
            if (e.code !== "ENOENT") {
              console.warn(
                "Could not delete file from public/assets:",
                e.message
              );
            }
          }

          // Also check and delete from uploads folder (in case it's there)
          const uploadsPath = path.join(uploadDir, imageFileName);
          try {
            await unlink(uploadsPath);
            console.log("Deleted product image from uploads:", imageFileName);
          } catch (e: any) {
            // File might not exist, that's okay
            if (e.code !== "ENOENT") {
              console.warn("Could not delete file from uploads:", e.message);
            }
          }
        }
      }

      // Delete from memory storage
      const deleted = await storage.deleteProduct(id);

      // Delete from JSON
      const remaining = productsArr.filter((p) => {
        const productId =
          typeof p.id === "string" ? parseInt(p.id, 10) : Number(p.id);
        return productId !== id;
      });
      await writeJsonArray(productsJsonPath, remaining);

      if (!deleted && productsArr.length === remaining.length) {
        return res.status(404).json({ message: "Product not found" });
      }

      console.log("Product deleted successfully, ID:", id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Failed to delete product:", error);
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // Campaign Products
  app.get("/api/campaigns/:campaignId/products", async (req, res) => {
    try {
      const campaignId = parseInt(req.params.campaignId);
      const campaignProducts = await storage.getCampaignProducts(campaignId);

      // Enrich with product details from JSON (persistent storage)
      const allProducts = await readJsonArray<any>(productsJsonPath);
      const enrichedProducts = campaignProducts.map(async (cp) => {
        // Try to find product in JSON first, fallback to in-memory
        let product = allProducts.find((p) => p.id === cp.productId) as any;
        if (!product) {
          // Fallback to in-memory if not found in JSON
          product = (await storage.getProduct(cp.productId)) as any;
        }
        return { ...cp, product };
      });

      res.json(enrichedProducts);
    } catch (error) {
      console.error("Failed to fetch campaign products:", error);
      res.status(500).json({ message: "Failed to fetch campaign products" });
    }
  });

  app.post("/api/campaigns/:campaignId/products", async (req, res) => {
    try {
      const campaignId = parseInt(req.params.campaignId);
      const productData = { ...req.body, campaignId };

      const campaignProduct = await storage.addProductToCampaign(productData);
      res.status(201).json(campaignProduct);
    } catch (error) {
      res.status(400).json({ message: "Invalid product data" });
    }
  });

  app.put("/api/campaign-products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

      const campaignProduct = await storage.updateCampaignProduct(id, updates);
      if (!campaignProduct) {
        return res.status(404).json({ message: "Campaign product not found" });
      }

      res.json(campaignProduct);
    } catch (error) {
      res.status(500).json({ message: "Failed to update campaign product" });
    }
  });

  app.delete("/api/campaign-products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.removeCampaignProduct(id);

      if (!deleted) {
        return res.status(404).json({ message: "Campaign product not found" });
      }

      res.json({ message: "Product removed from campaign" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to remove product from campaign" });
    }
  });

  // Templates
  app.get("/api/templates", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const arr = await readJsonArray<any>(templatesJsonPath);
      const templates = arr.filter(
        (t) => t.userId === userId || t.userId == null
      );
      if (templates.length === 0) {
        const fallback = await storage.getTemplates(userId);
        return res.json(fallback);
      }
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.post("/api/templates", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { name, description, userId, footerColor } = req.body;
      if (!name || !userId) {
        return res
          .status(400)
          .json({ message: "Name and user ID are required" });
      }

      // Validate file type - allow image files and common design files for templates
      const allowedMimes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "application/pdf",
        "text/html",
        "application/postscript",
      ];

      if (!allowedMimes.includes(req.file.mimetype)) {
        return res.status(400).json({
          message:
            "Invalid file type. Please upload an image, PDF, or HTML file.",
        });
      }

      // Copy also to public/assets for persistence
      const fileExtension = path.extname(
        req.file.originalname || req.file.filename
      );
      try {
        await copyToPublicAssets(req.file.path, name, fileExtension);
      } catch (e) {
        console.warn("Failed to duplicate template file to public/assets", e);
      }

      // Create in-memory for compatibility
      const template = await storage.createTemplate({
        name,
        description: description || null,
        filePath: req.file.filename, // keep filename for existing UI which uses /uploads/
        footerColor: footerColor || null,
        userId: parseInt(userId),
      });

      // Persist to JSON
      const arr = await readJsonArray<any>(templatesJsonPath);
      const record = {
        id: template?.id ?? nextId(arr),
        name,
        description: description || null,
        filePath: req.file.filename, // keep filename to work with /uploads/
        footerColor: footerColor || null,
        userId: parseInt(userId),
        createdAt: new Date().toISOString(),
      };
      arr.push(record);
      await writeJsonArray(templatesJsonPath, arr);

      res.status(201).json(record);
    } catch (error) {
      console.error("Template upload error:", error);
      res.status(500).json({ message: "Failed to upload template" });
    }
  });

  app.put("/api/templates/:id", upload.single("file"), async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      if (!templateId || isNaN(templateId)) {
        return res.status(400).json({ message: "Template ID is required" });
      }

      // Read form data - multer parses FormData fields into req.body
      const name = req.body?.name;
      const description = req.body?.description;
      const footerColor = req.body?.footerColor;

      // Debug logging
      console.log("PUT /api/templates/:id - Template ID:", templateId);
      console.log("PUT /api/templates/:id - Request body:", req.body);
      console.log(
        "PUT /api/templates/:id - File:",
        req.file ? "present" : "not present"
      );
      console.log(
        "PUT /api/templates/:id - Content-Type:",
        req.headers["content-type"]
      );

      // Validate required fields
      if (!name || (typeof name === "string" && name.trim() === "")) {
        return res.status(400).json({ message: "Template name is required" });
      }

      // Read templates from JSON
      const arr = await readJsonArray<any>(templatesJsonPath);
      const templateIndex = arr.findIndex((t) => t.id === templateId);

      if (templateIndex === -1) {
        return res.status(404).json({ message: "Template not found" });
      }

      const existingTemplate = arr[templateIndex];
      const updates: any = {
        name: typeof name === "string" ? name.trim() : name,
        description:
          description !== undefined
            ? typeof description === "string"
              ? description.trim() || null
              : description
            : existingTemplate.description,
        footerColor:
          footerColor !== undefined
            ? typeof footerColor === "string"
              ? footerColor.trim() || null
              : footerColor
            : existingTemplate.footerColor,
      };

      // Handle file update if new file is uploaded
      if (req.file) {
        // Validate file type
        const allowedMimes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/svg+xml",
          "application/pdf",
          "text/html",
          "application/postscript",
        ];

        if (!allowedMimes.includes(req.file.mimetype)) {
          return res.status(400).json({
            message:
              "Invalid file type. Please upload an image, PDF, or HTML file.",
          });
        }

        // Delete old file if exists
        if (existingTemplate.filePath) {
          const oldUploadsPath = path.join(
            process.cwd(),
            "uploads",
            existingTemplate.filePath
          );
          try {
            await unlink(oldUploadsPath);
          } catch (e) {
            console.warn("Could not delete old file from uploads:", e);
          }

          const oldPublicAssetsPath = path.join(
            process.cwd(),
            "public",
            "assets",
            existingTemplate.filePath
          );
          try {
            await unlink(oldPublicAssetsPath);
          } catch (e) {
            console.warn("Could not delete old file from public/assets:", e);
          }
        }

        // Copy new file to public/assets
        const fileExtension = path.extname(
          req.file.originalname || req.file.filename
        );
        try {
          await copyToPublicAssets(
            req.file.path,
            name || existingTemplate.name,
            fileExtension
          );
        } catch (e) {
          console.warn("Failed to duplicate template file to public/assets", e);
        }

        updates.filePath = req.file.filename;
      }

      // Update in-memory storage
      await storage.updateTemplate(templateId, updates);

      // Update in JSON
      const updatedTemplate = {
        ...existingTemplate,
        ...updates,
      };
      arr[templateIndex] = updatedTemplate;
      await writeJsonArray(templatesJsonPath, arr);

      res.json(updatedTemplate);
    } catch (error: any) {
      console.error("Template update error:", error);
      const errorMessage = error?.message || "Failed to update template";
      res.status(500).json({
        message: errorMessage,
        error:
          process.env.NODE_ENV === "development" ? error?.stack : undefined,
      });
    }
  });

  app.delete("/api/templates/:id", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }

      // Read templates from JSON
      const arr = await readJsonArray<any>(templatesJsonPath);
      const templateIndex = arr.findIndex((t) => t.id === templateId);

      if (templateIndex === -1) {
        return res.status(404).json({ message: "Template not found" });
      }

      const template = arr[templateIndex];

      // Delete physical files if they exist
      if (template.filePath) {
        // Delete from uploads folder
        const uploadsPath = path.join(
          process.cwd(),
          "uploads",
          template.filePath
        );
        try {
          await unlink(uploadsPath);
        } catch (e) {
          console.warn("Could not delete file from uploads:", e);
        }

        // Delete from public/assets folder
        const publicAssetsPath = path.join(
          process.cwd(),
          "public",
          "assets",
          template.filePath
        );
        try {
          await unlink(publicAssetsPath);
        } catch (e) {
          console.warn("Could not delete file from public/assets:", e);
        }
      }

      // Remove from array and save
      arr.splice(templateIndex, 1);
      await writeJsonArray(templatesJsonPath, arr);

      // Also remove from memory storage
      await storage.deleteTemplate(templateId);

      res.json({ message: "Template deleted successfully" });
    } catch (error) {
      console.error("Template delete error:", error);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // Logos
  app.get("/api/logos", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const logos = await readJsonArray<any>(logosJsonPath);
      const filtered = logos.filter(
        (l) => l.userId === userId || l.userId == null
      );
      if (filtered.length === 0) {
        const fallback = await storage.getLogos(userId);
        return res.json(fallback);
      }
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch logos" });
    }
  });

  app.get("/api/logos/active", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const logos = await readJsonArray<any>(logosJsonPath);
      const active = logos.find((l) => l.userId === userId && l.isActive);
      res.json(active || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch active logo" });
    }
  });

  app.post("/api/logos", upload.single("file"), async (req, res) => {
    try {
      const { name, userId } = req.body;

      if (!req.file) {
        return res.status(400).json({ message: "File is required" });
      }

      const logoName = name || req.file.originalname || "logo";
      const fileExtension = path.extname(
        req.file.originalname || req.file.filename
      );

      let fileNameOnly = req.file.filename;
      try {
        const publicAssetsPath = await copyToPublicAssets(
          req.file.path,
          logoName,
          fileExtension
        );
        fileNameOnly = publicAssetsPath.replace("/public/assets/", "");
      } catch (error) {
        console.error("Failed to copy logo to public/assets:", error);
      }

      // In-memory compatibility
      const logo = await storage.createLogo({
        name: logoName,
        userId: parseInt(userId),
        filePath: fileNameOnly,
        isActive: false,
      });

      // Persist JSON
      const arr = await readJsonArray<any>(logosJsonPath);
      const record = {
        id: logo?.id ?? nextId(arr),
        name: logoName,
        userId: parseInt(userId),
        filePath: fileNameOnly, // frontend supports public/assets check
        isActive: false,
        createdAt: new Date().toISOString(),
      };
      arr.push(record);
      await writeJsonArray(logosJsonPath, arr);

      res.status(201).json(record);
    } catch (error) {
      console.error("Logo upload error:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  app.put("/api/logos/:id/activate", async (req, res) => {
    try {
      const logoId = parseInt(req.params.id);
      const { userId } = req.body;

      const logos = await readJsonArray<any>(logosJsonPath);
      let found = false;
      const updated = logos.map((l) => {
        if (l.userId === userId) {
          const isTarget = l.id === logoId;
          if (isTarget) found = true;
          return { ...l, isActive: isTarget };
        }
        return l;
      });
      if (!found) {
        return res.status(404).json({ message: "Logo not found" });
      }
      await writeJsonArray(logosJsonPath, updated);

      // keep in-memory in sync
      await storage.setActiveLogo(userId, logoId);

      res.json({ message: "Logo activated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to activate logo" });
    }
  });

  // Generate PDF (placeholder endpoint)
  app.post("/api/campaigns/:id/generate-pdf", async (req, res) => {
    try {
      // In a real implementation, you would use a library like puppeteer or jsPDF
      // to generate a PDF from the brochure design
      res.json({
        message: "PDF generation would be implemented here",
        downloadUrl: "/api/downloads/brochure.pdf",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Statistics endpoint
  app.get("/api/statistics", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const campaigns = await storage.getCampaigns(userId);
      const templates = await storage.getTemplates(userId);

      const stats = {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.status === "active").length,
        totalTemplates: templates.length,
        totalDownloads: 156, // Mock value for demo
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
