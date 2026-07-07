#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import pkgJson from "../package.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __baseDir = process.env.PWD;

if (!fs.existsSync(`${__baseDir}/package.json`)) {
    console.log(pc.red(`Please execute the script from the root of the app where package.json resides.`));
    process.exit(1);
}

if (!process.env.NODE_ENV || process.env.NODE_ENV?.length === 0) {
    console.log(pc.red("Please specify NODE_ENV. For local dev, use 'development'."));
    process.exit(1);
}

const [command] = process.argv.slice(2);
const env = process.env.NODE_ENV;
const appName = pkgJson.name;

const publicKey = path.join(__dirname, "..", `${appName}-public.pem`);
const privateKey = path.join(__dirname, "..", `${appName}-private.pem`);
const encryptionPadding = crypto.constants.RSA_PKCS1_OAEP_PADDING;

function encryptWithAES(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "base64"), iv);

    let encryptedData = cipher.update(data, "utf8", "base64");
    encryptedData += cipher.final("base64");

    // Concatenate IV and encrypted data for later decryption
    return iv.toString("base64") + ":" + encryptedData;
}

function encryptFile(publicKey, filePath) {
    const aesKey = crypto.randomBytes(32).toString("base64");

    const data = fs.readFileSync(filePath, "utf8");
    const encryptedData = encryptWithAES(data, aesKey);

    // Encrypt the AES key using the RSA public key
    const encryptedAESKey = crypto.publicEncrypt(
        { key: publicKey, padding: encryptionPadding, oaepHash: "sha256" },
        Buffer.from(aesKey, "base64"),
    );

    // Save the encrypted data to the output file
    const outputPath = filePath + ".encrypted";
    fs.writeFileSync(outputPath, encryptedData);

    // Save the encrypted AES key to a separate file
    const encryptedAESKeyPath = outputPath + ".key";
    fs.writeFileSync(encryptedAESKeyPath, encryptedAESKey);

    console.log("Two files generated. Check both these files into git:");
    console.log(` 1. ${outputPath.replace(__baseDir, "").slice(1)}`);
    console.log(` 2. ${encryptedAESKeyPath.replace(__baseDir, "").slice(1)}`);
}

function generateFilePath(fileName) {
    return path.join(__dirname, "..", "config", fileName);
}

function decryptWithAES(encryptedData, key) {
    const [ivString, encryptedDataString] = encryptedData.split(":");
    const iv = Buffer.from(ivString, "base64");
    const cipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "base64"), iv);

    let decryptedData = cipher.update(encryptedDataString, "base64", "utf8");
    decryptedData += cipher.final("utf8");

    return decryptedData;
}

function decryptFile(privateKey, encryptedFilePath, encryptedAESKeyPath) {
    const encryptedAESKey = fs.readFileSync(encryptedAESKeyPath);

    // Decrypt the AES key using the RSA private key
    const aesKey = crypto
        .privateDecrypt({ key: privateKey, padding: encryptionPadding, oaepHash: "sha256" }, encryptedAESKey)
        .toString("base64");
    const encryptedData = fs.readFileSync(encryptedFilePath, "utf8");
    const decryptedData = decryptWithAES(encryptedData, aesKey);

    const decryptedFilePath = encryptedFilePath.replace(".encrypted", "");
    fs.writeFileSync(decryptedFilePath, decryptedData);

    const localFile = decryptedFilePath.replace(__baseDir, "").slice(1);
    console.log(`\nDecryption completed. File written to ${pc.green(localFile)}`);
}

function generateKeys() {
    const { privateKey: newPrivateKey, publicKey: newPublicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: "spki",
            format: "pem",
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
        },
    });

    fs.writeFileSync(publicKey, newPublicKey);
    fs.writeFileSync(privateKey, newPrivateKey);

    if (fs.existsSync(publicKey)) {
        console.log(pc.green(`Created ${path.basename(publicKey)}`));
    } else {
        console.log(pc.red(`ERROR could not generate '${publicKey}'`));
    }

    if (fs.existsSync(privateKey)) {
        console.log(pc.green(`Created ${path.basename(privateKey)}`));
    } else {
        console.log(pc.red(`ERROR could not generate '${privateKey}'`));
    }

    if (fs.existsSync(publicKey) && fs.existsSync(privateKey)) {
        console.log(`\nProcess complete. Keep both these files secure.`);
    }
}

switch (command) {
    case "encrypt": {
        console.log(`Encrypting for environment: ${pc.green(env)}`);

        const key = fs.existsSync(publicKey) ? fs.readFileSync(publicKey, "utf8") : process.env.ENCRYPTION_PUBLIC_KEY;
        if (!key) {
            const keyPath = path.basename(publicKey);
            console.log(pc.yellow(`Public key not found. Provide the key as a '${keyPath}' file.`));
            console.log(pc.yellow(`Alternatively use a 'ENCRYPTION_PUBLIC_KEY' environment variable.`));
            process.exit(1);
        }

        const filePath = generateFilePath(`local-${process.env.NODE_ENV}.json`);
        if (fs.existsSync(filePath)) {
            console.log(`Encrypting data in ${pc.green(path.basename(filePath))}\n`);
        } else {
            console.log(pc.yellow(`${filePath} does not exist`));
            process.exit(1);
        }

        try {
            encryptFile(key, filePath);
        } catch (error) {
            console.log(pc.red(`Encryption failed for ${filePath}`));
            console.log(error);
            process.exit(1);
        }

        break;
    }

    case "decrypt": {
        console.log(`Decrypting for environment: ${pc.green(env)}`);
        const decryptKey = fs.existsSync(privateKey)
            ? fs.readFileSync(privateKey, "utf8")
            : process.env.ENCRYPTION_PRIVATE_KEY.split(String.raw`\n`).join("\n");

        if (!decryptKey || (typeof decryptKey === "string" && decryptKey.length <= 1)) {
            const keyPath = path.basename(privateKey);
            console.log(pc.yellow(`Private key not found. Provide the key as a '${keyPath}' file.`));
            console.log(pc.yellow(`Alternatively use a 'ENCRYPTION_PRIVATE_KEY' environment variable.`));
            process.exit(1);
        }

        const encryptedFilePath = generateFilePath(`local-${env}.json.encrypted`);
        if (fs.existsSync(encryptedFilePath)) {
            console.log(`Decrypting data from ${pc.green(path.basename(encryptedFilePath))}`);
        } else {
            console.log(pc.yellow(`Missing ${encryptedFilePath}. It must exist in the config folder`));
            process.exit(1);
        }

        const encryptedAESKeyPath = generateFilePath(`local-${env}.json.encrypted.key`);
        if (fs.existsSync(encryptedAESKeyPath)) {
            console.log(`Using ${env} key from ${pc.green(path.basename(encryptedAESKeyPath))}`);
        } else {
            console.log(pc.yellow(`Missing ${encryptedAESKeyPath}. It must exist in the config folder`));
            process.exit(1);
        }

        try {
            decryptFile(decryptKey, encryptedFilePath, encryptedAESKeyPath);
        } catch (error) {
            console.log(pc.red(`Error decrypting file`));
            console.log(error);
            process.exit(1);
        }

        break;
    }

    case "generateKeys":
        try {
            console.log("Generating keys");
            generateKeys();
        } catch (error) {
            console.log(pc.red(`Error generating keys`));
            console.log(error);
        }

        break;

    default:
        console.log(pc.red("Please specify a valid command. 'encrypt', 'decrypt' or 'generateKeys'"));
}
