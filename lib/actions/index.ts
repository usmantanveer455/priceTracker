"use server"

import { revalidatePath } from "next/cache";
import Product from "../models/product.model";
import { connectToDB } from "../mongoose";
import { scrapeAmazonProduct } from "../scraper";
import { getAveragePrice, getHighestPrice, getLowestPrice } from "../utils";
import { User } from "@/types";
import { generateEmailBody, sendEmail } from "../nodemailer";

export async function scrapeAndStoreProduct(productUrl: string) {
  if(!productUrl) return;

  try {
    connectToDB();

    const scrapedProduct = await scrapeAmazonProduct(productUrl);

    if(!scrapedProduct) return;

    let product = scrapedProduct;

    const existingProduct = await Product.findOne({ url: scrapedProduct.url });

    if(existingProduct) {
      const updatedPriceHistory: any = [
        ...existingProduct.priceHistory,
        { price: scrapedProduct.currentPrice }
      ]

      product = {
        ...scrapedProduct,
        priceHistory: updatedPriceHistory,
        lowestPrice: getLowestPrice(updatedPriceHistory),
        highestPrice: getHighestPrice(updatedPriceHistory),
        averagePrice: getAveragePrice(updatedPriceHistory),
      }
    }
console.log(scrapedProduct)
    const newProduct = await Product.findOneAndUpdate(
      { url: scrapedProduct.url },
      product,
      { upsert: true, new: true }
    );

    revalidatePath(`/products/${newProduct._id}`);
  } catch (error: any) {
    throw new Error(`Failed to create/update product: ${error.message}`)
  }
}

export async function getProductById(productId: string) {
  try {
    connectToDB();

    const product = await Product.findOne({ _id: productId });

    if(!product) return null;

    return product;
  } catch (error) {
    console.log(error);
  }
}

export async function getAllProducts() {
  try {
    connectToDB();

    const products = await Product.find();

    return products;
  } catch (error) {
    console.log(error);
  }
}

export async function getSimilarProducts(productId: string) {
  try {
    connectToDB();

    const currentProduct = await Product.findById(productId);

    if(!currentProduct) return null;

    const similarProducts = await Product.find({
      _id: { $ne: productId },
    }).limit(3);

    return similarProducts;
  } catch (error) {
    console.log(error);
  }
}

export async function addUserEmailToProduct(productId: string, userEmail: string, userPrice: string) {
  try {

    const product = await Product.findById(productId);

    if(!product) return;

    const userExists = product.users.some((user: User) => user.email === userEmail);

    if(!userExists) {      
      // const preferredPrice = parseFloat(userPrice);
      product.users.push({ email: userEmail, userPrice: userPrice });

      await product.save();

      const emailContent = await generateEmailBody(product, "WELCOME");

      await sendEmail(emailContent, [userEmail]);
    } else {
      const indexToUpdate = product.users.findIndex((user: User) => user.email === userEmail);
      if (indexToUpdate !== -1) {
        product.users[indexToUpdate] = { email: userEmail, userPrice: userPrice };

        await product.save();
      }
    }


  } catch (error) {
    console.log(error);
  }
}

export async function checkUserPriceAndSendEmail() {
  try {
    const products = await getAllProducts();
    console.log("Products:", products);
    if (!products || products.length === 0) {
      console.log("No products found");
      return;
    }

    for (const product of products) {
      if (!product.users || product.users.length === 0) {
        console.log(`No users found for product: ${product._id}`);
        continue;
      }

      for (const user of product.users) {
        if (product.currentPrice <= user.userPrice) {
          const emailContent = await generateEmailBody(product, "PRICE_EQUALED");
          await sendEmail(emailContent, [user.email]);
          user.userPrice = 0;
        } else if (product.currentPrice <= 0.85 * product.currentPrice) {
          const emailContent = await generateEmailBody(product, "LOWEST_PRICE");
          await sendEmail(emailContent, [user.email]);
        }
      }
      await product.save();
    }
  } catch (error) {
    console.log(error);
  }
}


