/**
 * Official PlayStation Blog Deep-Content Parser (Enterprise Edition)
 * - Native XML parsing (bypasses 429 Rate Limits)
 * - LockService to prevent overlapping runs
 * - Discord 429 Rate Limit retry loop with max-sleep abort
 * - Extracts full console tags and formats into clean numbered lists.
 * - Added Diagnostic Visibility Logging
 */

function checkOfficialPSPlusFeed() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    console.log("⏳ Another run is in progress, skipping.");
    return;
  }

  try {
    // === 1. CONFIGURATION ===
    const webhookUrl = "YOUR_DISCORD_WEBHOOK_HERE"; // PASTE YOUR WEBHOOK URL HERE
    
    // CACHE BUSTING: Forces Google to fetch a fresh feed every single time
    const cacheBuster = new Date().getTime();
    const rssUrl = "https://blog.playstation.com/category/ps-plus/feed/?cb=" + cacheBuster;
    
    console.log("📡 Fetching native RSS directly from PlayStation...");
    const response = UrlFetchApp.fetch(rssUrl, {muteHttpExceptions: true});
    
    if (response.getResponseCode() !== 200) {
      console.error("❌ Aborting: PS Blog returned error " + response.getResponseCode());
      return;
    }

    // === 2. NATIVE XML PARSING ===
    const document = XmlService.parse(response.getContentText());
    const root = document.getRootElement();
    const channel = root.getChild('channel');
    const items = channel.getChildren('item');
    
    const contentNs = XmlService.getNamespace('content', 'http://purl.org/rss/1.0/modules/content/');

    let posts = [];
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      posts.push({
        title: item.getChildText('title'),
        link: item.getChildText('link'),
        guid: item.getChildText('guid') || item.getChildText('link'),
        content: item.getChildText('encoded', contentNs) || item.getChildText('description') || ""
      });
    }

    console.log("✅ Successfully loaded " + posts.length + " posts natively.");

    // === 3. FILTER & EXECUTE (With Loop Locks) ===
    let foundEssential = false;
    let foundCatalog = false;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const titleLower = post.title.toLowerCase();
      const postId = post.guid;
      
      // DIAGNOSTIC LOG: See exactly what the script is reading
      console.log("🔍 Scanning feed item " + (i + 1) + ": " + post.title);
      
      // Check for Essential games
      if (!foundEssential && titleLower.includes("monthly games for")) {
        foundEssential = true; 
        
        const lastEssentialId = PropertiesService.getScriptProperties().getProperty('LAST_ESSENTIAL_ID');
        if (postId !== lastEssentialId) {
          const success = processBlogContent(webhookUrl, post, "Essential");
          if (success) {
            PropertiesService.getScriptProperties().setProperty('LAST_ESSENTIAL_ID', postId);
          }
        } else {
          console.log("✅ Already in memory (Skipping Essential): " + post.title);
        }
      }
      
      // Check for Catalog games
      if (!foundCatalog && titleLower.includes("game catalog for")) {
        foundCatalog = true; 
        
        const lastCatalogId = PropertiesService.getScriptProperties().getProperty('LAST_CATALOG_ID');
        if (postId !== lastCatalogId) {
          const success = processBlogContent(webhookUrl, post, "Catalog");
          if (success) {
            PropertiesService.getScriptProperties().setProperty('LAST_CATALOG_ID', postId);
          }
        } else {
          console.log("✅ Already in memory (Skipping Catalog): " + post.title);
        }
      }

      // Break the loop once we've checked the newest of both categories
      if (foundEssential && foundCatalog) {
        console.log("🛑 Found the newest for both categories. Breaking loop.");
        break; 
      }
    }
  } catch (error) {
    console.error("❌ Execution error: " + error.message);
  } finally {
    lock.releaseLock();
  }
}

// === HELPER FUNCTION: Extracts games using multiple failsafes ===
function extractGameList(htmlBlock, fallbackTitle = "") {
  let extractedGames = [];

  // Decode HTML Entities 
  let decodedHtml = htmlBlock
    .replace(/&#8211;/g, '-')  
    .replace(/&#8212;/g, '-')  
    .replace(/&#8217;/g, "'")  
    .replace(/&amp;/g, '&')    
    .replace(/&nbsp;/g, ' ');  

  let textWithNewlines = decodedHtml.replace(/<\/?(p|br|li|h[1-6]|div)[^>]*>/gi, '\n');
  let cleanText = textWithNewlines.replace(/<[^>]*>?/gm, '');
  let lines = cleanText.split('\n');

  // Isolates the title + console, dropping the paragraph description
  function isolateGameString(rawLine) {
    let splitLine = rawLine.split(/\.\s/)[0].trim();
    if (splitLine.endsWith('.')) splitLine = splitLine.slice(0, -1);
    return splitLine;
  }

  // STRATEGY 1: The "Pipe" Marker (Keeps console tags)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.includes("| PS") || line.includes("|PS")) {
      let gameString = isolateGameString(line);
      
      if (gameString.length > 2 && !extractedGames.includes(gameString)) {
        extractedGames.push(gameString);
      }
    }
  }

  // STRATEGY 2: Fallback to Bullet Points
  if (extractedGames.length === 0) {
    const listRegex = /<li>(.*?)<\/li>/g;
    let match;
    while ((match = listRegex.exec(decodedHtml)) !== null) {
      let rawText = match[1].replace(/<[^>]*>?/gm, '').trim();
      let gameString = isolateGameString(rawText);
      
      if (gameString.length > 2 && gameString.length < 80 && !gameString.toLowerCase().includes("last chance") && !extractedGames.includes(gameString)) {
        extractedGames.push(gameString);
      }
    }
  }

  // STRATEGY 3: "Nuclear" Title Fallback
  if (extractedGames.length === 0 && fallbackTitle.includes(":")) {
    let cleanTitle = fallbackTitle.replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").replace(/&amp;/g, '&');
    let titleString = cleanTitle.split(":")[1].replace(/and more/i, "").trim();
    let rawGames = titleString.split(/,(?![^()]*\))|\s+and\s+/i);
    for (let i = 0; i < rawGames.length; i++) {
      let gameName = rawGames[i].trim();
      if (gameName.length > 2 && !extractedGames.includes(gameName)) {
        extractedGames.push(gameName);
      }
    }
  }

  return extractedGames;
}

// === HELPER FUNCTION: Formats the Discord text with a numbered list ===
function formatListText(gameArray) {
  if (gameArray.length === 0) return "> *None detected or formatting changed.*\n";
  
  let listText = "";
  for (let i = 0; i < gameArray.length; i++) {
    let game = gameArray[i];
    listText += (i + 1) + ". **" + game + "**\n";
  }
  return listText;
}

// === CORE DISCORD PAYLOAD BUILDER ===
function processBlogContent(webhookUrl, post, type) {
  let embedColor = 0;
  let messageContent = "";
  let tierText = "";

  if (type === "Catalog") {
    embedColor = 3447003; 
    
    // Protect the Extra headers
    let safeHtml = post.content.replace(/Extra and Premium/ig, "Extra_And_Premium");
    safeHtml = safeHtml.replace(/Extra & Premium/ig, "Extra_And_Premium");
    
    // Split into Premium chunks
    let blocks = safeHtml.split(/<h[1-4][^>]*>[^<]*Premium[^<]*<\/h[1-4]>/i);
    
    if (blocks.length === 1) {
      blocks = safeHtml.split(/<p>\s*<strong>[^<]*Premium[^<]*<\/strong>\s*<\/p>/i);
    }
    
    if (blocks.length === 1) {
      let splitIndex = safeHtml.indexOf("PlayStation Plus Premium", 800);
      if (splitIndex === -1) splitIndex = safeHtml.indexOf("Premium | Classics", 800);
      
      if (splitIndex !== -1) {
        blocks = [safeHtml.substring(0, splitIndex), safeHtml.substring(splitIndex)];
      }
    }

    let extraBlock = blocks[0] || "";
    let premiumBlock = blocks[1] || ""; 

    let extraGames = extractGameList(extraBlock, post.title);
    let premiumGames = extractGameList(premiumBlock, "");

    messageContent = "@everyone 🌟 **New PS Plus Game Catalog Update!**\n\n";
    messageContent += "🟦 **EXTRA:**\n" + formatListText(extraGames) + "\n";
    
    if (premiumGames.length > 0) {
      messageContent += "🟪 **PREMIUM:**\n" + formatListText(premiumGames);
    }
    
    tierText = "Click the blog link below to see platform details (PS4/PS5).";
    
  } else {
    embedColor = 16766720; 
    
    let essentialGames = extractGameList(post.content, post.title);
    
    messageContent = "@everyone 🚨 **New PS Plus Essential Games Announced!**\n\n";
    messageContent += "🟨 **MONTHLY GAMES:**\n" + formatListText(essentialGames);
    
    tierText = "Click the blog link below for full details.";
  }

  // Adds the invisible line break
  messageContent += "\n\u200B";

  let imageUrl = "";
  const imgMatch = post.content.match(/src="(https:\/\/[^"]+\.(jpg|png|jpeg))"/i);
  if (imgMatch) {
      imageUrl = imgMatch[1];
  }

  const payload = {
    "username": "Talherz Waifu",
    "content": messageContent, 
    "embeds": [{
      "title": post.title,
      "url": post.link,
      "description": tierText,
      "image": { "url": imageUrl },
      "color": embedColor,
      "footer": { "text": "Official PlayStation Blog Auto-Parse" },
      "timestamp": new Date().toISOString()
    }]
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true 
  };
  
  console.log("Attempting to send alert to Discord for: " + post.title);
  
  // === RETRY LOOP FOR DISCORD RATE LIMITS ===
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(webhookUrl, options);
    const resCode = res.getResponseCode();

    if (resCode === 200 || resCode === 204) {
      console.log("✅ SUCCESS! Discord accepted the message.");
      return true;
    }

    if (resCode === 429) {
      const retryAfter = Number(res.getHeaders()["Retry-After"] || 2);
      
      // If Discord asks us to wait longer than 250 seconds, we abort gracefully.
      if (retryAfter > 250) {
        console.error("❌ Discord rate limit is too long (" + retryAfter + "s). Aborting attempt. Will retry next hour.");
        return false;
      }

      console.warn("⚠️ Rate limited. Retry after " + retryAfter + "s (attempt " + attempt + "/3)");
      Utilities.sleep(retryAfter * 1000);
      continue;
    }

    console.error("❌ DISCORD REJECTED IT! Error code: " + resCode);
    return false;
  }
  
  console.error("❌ Discord still rate-limiting after 3 retries.");
  return false;
}