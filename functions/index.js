/* eslint-disable max-len */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const {Configuration, OpenAIApi} = require("openai");
const {defineSecret} = require("firebase-functions/params");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const axios = require("axios");
const cheerio = require("cheerio");
const wordsCount = require("words-count").default;

// onCreate function for the "nlps" collection, call OpenAI createChatCompletion API and update the collections with the details in response
exports.onCreateNlp = functions.runWith({secrets: [openAiApiKey], timeoutSeconds: 120}).firestore.document("nlps/{nlpId}").onCreate((nlpSnap, context) => {
  const nlp = nlpSnap.data();
  const configuration = new Configuration({
    apiKey: openAiApiKey.value(),
  });
  const openai = new OpenAIApi(configuration);
  console.log("nlp.type: ", nlp.type);
  if (nlp.type && nlp.type === "feedback") {
    console.log("nlp.feedbacks: ", nlp.feedbacks);
    const openaiSystem = "You are customer relationship manager's assistant, analysing customer feedbacks for feedback's sentiment and topic.";
    let openaiRequest = "Topics of feedbacks can be: 'LivBetter' for carbon footprint,'Nav Planner' for fianncial planning,'Login','App Slowness','Insights','App Navigation','App Features','Account Management','Credit Card Services','Customer Service','Fraud and Security','Loan Services','Products and Services','Rates and Fees','Transaction Issues','Corporate Banking' or 'General'.\nFor the following 2 items:\nitem 1: Nav Planner and Insights are very helpful.\nitem 2: Fingerprint login in failing.\nJSON response is:\n[{\"item\":1,\"analysis\":[{\"topic\":\"Nav Planner\",\"sentiment\":0.9},{\"topic\":\"Insights\",\"sentiment\":0.9}]},{\"item\":2,\"analysis\":[{\"topic\":\"Login\",\"sentiment\":-0.6}]}]\n\nCreate a JSON response for the following items:";
    nlp.feedbacks.forEach((feedback, index) => {
      openaiRequest += "\nitem " + (index + 1) + ": " + feedback;
    });

    // query nlp collection, for existing feedback requests, if the request is same as the current request, return the response
    return admin.firestore().collection("nlps").where("request", "==", openaiRequest).where("successful", "==", true).get().then((matchSnap) => {
      if (matchSnap.empty) {
        console.log("Request not in cache, calling OpenAI ChatCompletion API");
        return openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [
            {role: "system", content: openaiSystem},
            {role: "user", content: openaiRequest}],
        }).then((response) => {
          return registerFeedbacks(
              openaiRequest,
              openaiSystem,
              response.data.choices[0].message.content,
              nlp,
              nlpSnap.ref,
              false,
          );
        }).catch((error) => {
          console.error(error);
        });
      } else {
        console.log("Request found in cache!");
        return registerFeedbacks(
            openaiRequest,
            openaiSystem,
            matchSnap.docs[0].data().response,
            nlp,
            nlpSnap.ref,
            true,
        );
      }
    });
  } else if (nlp.type && nlp.type === "content") {
    const openaiSystem = "You are a professional copywriter, rewriting different contents for different customer demographics";
    const openaiUser1 = "Content: Freedom card is pre-approved. click {{link}} to apply.\nDemographics:\nmale. employed. age:25 to 35\nfemale. unemployed. age:18 to 25";
    const openaiAssistant1 = "[{\"gender\":\"male\",\"employment_status\":\"employed\",\"minimum_age\":25,\"maximum_age\":35,\"subject\":\"Pre-Approved Freedom Card\",\"body\":\"Dear {{first_name}},\n\nWe are pleased to inform you that you have been pre-approved for our new 'Freedom' card. Please click {{link}} to apply for your card.\"},{\"gender\":\"female\",\"employment_status\":\"unemployed\",\"minimum_age\":18,\"maximum_age\":25,\"subject\":\"Freedom Card for You!\",\"body\":\"Hi {{first_name}}, \n\nOur 'Freedom' card has been pre-approved, for you to enjoy your financial freedom! Click{{link}} to apply\"}]";
    let openaiUser2 = "Content: " + nlp.content + "\nDemographics:";
    if (nlp.age18to25) {
      openaiUser2 += "\nmale. unemployed. age:18 to 25\nfemale. unemployed. age:18 to 25";
    }
    if (nlp.age25to35) {
      openaiUser2 += "\nmale. employed. age:25 to 35\nfemale. employed. age:25 to 35";
    }
    if (nlp.age35to50) {
      openaiUser2 += "\nmale. employed. age:35 to 50\nfemale. employed. age:35 to 50";
    }
    if (nlp.age50to65) {
      openaiUser2 += "\nmale. employed. age:50 to 65\nfemale. employed. age:50 to 65";
    }
    if (nlp.age65to80) {
      openaiUser2 += "\nmale. employed. age:65 to 80\nfemale. employed. age:65 to 80";
    }

    return admin.firestore().collection("nlps").where("request", "==", openaiUser2).where("successful", "==", true).get().then((matchSnap) => {
      if (matchSnap.empty) {
        console.log("Request not in cache, calling OpenAI ChatCompletion API for Content Rewriting");
        return openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [
            {role: "system", content: openaiSystem},
            {role: "user", content: openaiUser1},
            {role: "assistant", content: openaiAssistant1},
            {role: "user", content: openaiUser2}],
        }).then((response) => {
          return registerContents(
              openaiUser2,
              openaiSystem,
              response.data.choices[0].message.content,
              nlp,
              nlpSnap.ref,
              false,
          );
        }).catch((error) => {
          console.error(error);
        });
      } else {
        console.log("Request found in cache!");
        return registerContents(
            openaiUser2,
            openaiSystem,
            matchSnap.docs[0].data().response,
            nlp,
            nlpSnap.ref,
            true,
        );
      }
    });
  } else {
    console.log("Unknown NLP type: " + nlp.type);
    return;
  }
});

// onCreate function for the "extracts" collection, this function is triggered when a new document is added to the "extracts" collection
exports.onCreateExtract = functions.runWith({secrets: [openAiApiKey], timeoutSeconds: 120}).firestore.document("extracts/{extractId}").onCreate((extractSnap, context) => {
  const extract = extractSnap.data();
  // check if URL alrady exists in an existing extracts document and summary is not undefined or empty
  return admin.firestore().collection("extracts").where("url", "==", extract.url).where("summary", "!=", "").get().then((matchSnap) => {
    if (matchSnap.empty) {
      // scrape extract.url and update the document with the cleaned text
      return axios(extract.url).then((response) => {
        const html = response.data;
        const $ = cheerio.load(html);
        let text = $("div#mw-content-text p").text();

        // if wikipedia url, remove wiki comments
        if (extract.url.includes("wikipedia")) {
          text = removeWikiComments(text);
        }
        const words = wordsCount(text);
        console.log("Extracted " + words + " words from " + extract.url);
        // update the document with the cleaned text
        extractSnap.ref.update({
          clean: text,
          updated: admin.firestore.FieldValue.serverTimestamp(),
          words: words,
          cached: false,
        });

        // call the OpenAI API to extract the facts from the text
        if (text) {
          const configuration = new Configuration({
            apiKey: openAiApiKey.value(),
          });
          const openai = new OpenAIApi(configuration);
          const openaiSystem = "You are an office assistant, extracting summary and facts from documents in JSON format";
          const openaiUser1 = "Extract facts from the following document:\n\nOpenAI's Generative Pre-trained Transformer 3 (GPT-3) is an autoregressive language model released in 2020 that uses deep learning to produce human-like text. Given an initial text as prompt, it will produce text that continues the prompt. The quality of the text generated by GPT-3 is so high that it can be difficult to determine whether or not it was written by a human, which has both benefits and risks. Thirty-one OpenAI researchers and engineers presented the original May 28, 2020 paper introducing GPT-3. In their paper, they warned of GPT-3's potential dangers and called for research to mitigate risk.";
          const openaiAssistant1 = "{\"summary\":\"GPT-3 produces human-like text. OpenAI called for mitigating it's risks.\",\"facts\":[\"GPT-3 is an autoregressive language model that uses deep learning\",\"It produces high quality human-like text that continues the prompt\",\"OpenAI paper introducing GPT-3 on 28 May 2020, called for research to mitigate it's potential risks\"]}";
          const openaiUser2 = "Extract facts from the following document:\n\n" + text;
          return openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [
              {role: "system", content: openaiSystem},
              {role: "user", content: openaiUser1},
              {role: "assistant", content: openaiAssistant1},
              {role: "user", content: openaiUser2}],
          }).then((response) => {
            const responseText = response.data.choices[0].message.content;
            const extract = (function() {
              try {
                const jsonStart = responseText.indexOf("{");
                const jsonEnd = responseText.lastIndexOf("}") + 1;
                const jsonString = responseText.substring(jsonStart, jsonEnd);
                console.log("Response jsonString: ", jsonString);
                return JSON.parse(jsonString);
              } catch (error) {
                console.error(error);
                const jsonStart = responseText.indexOf("\"summary\"");
                const jsonEnd = responseText.lastIndexOf("\"]") + 2;
                const jsonString = "{" + responseText.substring(jsonStart, jsonEnd) + "}";
                console.log("Fixed response jsonString: ", jsonString);
                return JSON.parse(jsonString);
              }
            })();
            extract["response"] = responseText;
            extract["updated"] = admin.firestore.FieldValue.serverTimestamp();
            extract["cached"] = false;
            return extractSnap.ref.update(extract);
          }).catch(console.error);
        } else {
          console.log("No text to extract from");
          return;
        }
      }).catch(console.error);
    } else {
      const match = matchSnap.docs[0].data();
      console.log("URL already exists, using cached data");
      return extractSnap.ref.update({
        clean: match.clean,
        summary: match.summary,
        facts: match.facts,
        response: match.response,
        updated: admin.firestore.FieldValue.serverTimestamp(),
        words: match.words,
        cached: true,
      });
    }
  }).catch(console.error);
});

// on update of the chats collection as child of extracts collection, call openai to generate assistant response
exports.onUpdateChat = functions.runWith({secrets: [openAiApiKey]}).firestore.document("extracts/{extractId}/chats/{chatId}").onUpdate((change, context) => {
  const chat = change.after.data();
  if (chat.processed) {
    console.log("Not Processing assistant comment in chat");
    return Promise.resolve();
  }
  console.log("Processing new user comment in chat");
  const extractSnap = change.after.ref.parent.parent;
  return extractSnap.get().then((extractDoc) => {
    const extract = extractDoc.data();
    const configuration = new Configuration({apiKey: openAiApiKey.value()});
    const openai = new OpenAIApi(configuration);
    console.log("chat.conversation: ", chat.conversation);
    // get the last element of the conversation array in chat document
    const lastConversation = chat.conversation[chat.conversation.length - 1];
    console.log("lastConversation: ", lastConversation);
    const chatMessages = [
      {role: "system", content: "You are an office assistant and an analyst, discussing the provided document"},
      {role: "user", content: "Answer the following question\n\nWhen was GPT-3 released?\n\nBased on the following document:\n\nOpenAI's Generative Pre-trained Transformer 3 (GPT-3) is an autoregressive language model released in 2020 that uses deep learning to produce human-like text. Given an initial text as prompt, it will produce text that continues the prompt. The quality of the text generated by GPT-3 is so high that it can be difficult to determine whether or not it was written by a human, which has both benefits and risks."},
      {role: "assistant", content: "GPT-3 was released in 2020."},
      {role: "user", content: "Answer the following question\n\n" + lastConversation + "\n\nBased on the following document:\n\n" + extract.clean},
    ];
    return openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: chatMessages,
    }).then((response) => {
      const responseText = response.data.choices[0].message.content.trim();
      return change.after.ref.update({
        conversation: admin.firestore.FieldValue.arrayUnion("Bot: " + responseText),
        updated: admin.firestore.FieldValue.serverTimestamp(),
        processed: true,
      });
    }).catch(console.error);
  }).catch(console.error);
});

// http endpoint to delete all feedbacks for a nlp when the nlp is deleted
exports.deleteNlpFeedbacks = functions.firestore.document("nlps/{nlpId}").onDelete((nlpSnap, context) => {
  const nlp = nlpSnap.data();
  console.log("nlp.feedbacks: ", nlp.feedbacks);
  const feedbacksRef = admin.firestore().collection("feedbacks");
  return feedbacksRef.where("nlp", "==", nlpSnap.ref).get().then((querySnapshot) => {
    querySnapshot.forEach((doc) => {
      doc.ref.delete();
    });
  }).catch((error) => {
    console.error(error);
  });
});

/**
 * Add all feedback attributes from openaiRequest and responseText to the "feedbacks" collection
 * @param {string} openaiRequest the request sent to the OpenAI API
 * @param {string} openaiSystem the system definition sent to the OpenAI API
 * @param {string} rawResponseText the response from the OpenAI API call
 * @param {object} nlp the nlp document used for OpenAI API call
 * @param {object} nlpRef docement reference to the nlp document
 * @param {boolean} cached true if the response was cached
 */
function registerFeedbacks(openaiRequest, openaiSystem, rawResponseText, nlp, nlpRef, cached) {
  // remove new lines and extra spaces from the response
  const responseText = trimJsonString(rawResponseText);
  // parse the response to JSON, if the response is not in the expected format, try to fix it
  const responseJson = (function() {
    try {
      const jsonStart = responseText.indexOf("[{");
      const jsonEnd = responseText.lastIndexOf("}]}]") + 4;
      const jsonString = responseText.substring(jsonStart, jsonEnd);
      console.log("Response jsonString: ", jsonString);
      return JSON.parse(jsonString);
    } catch (error) {
      console.error(error);
      const jsonStart = responseText.indexOf("\"item\"");
      const jsonEnd = responseText.lastIndexOf("}]}") + 3;
      const jsonString = "[{" + responseText.substring(jsonStart, jsonEnd) + "]";
      console.log("Fixed response jsonString: ", jsonString);
      return JSON.parse(jsonString);
    }
  })();
  console.log("JSON parsing successful");
  // cache the response in nlp document
  nlpRef.update({
    request: openaiRequest,
    system: openaiSystem,
    response: responseText,
    updated: admin.firestore.FieldValue.serverTimestamp(),
    chached: cached,
    successful: true,
  });
  responseJson.forEach((feedback) => {
    feedback.submission = nlp.feedbacks[feedback.item - 1];
    feedback.nlp = nlpRef;
    feedback.owner = nlp.owner;
    feedback.created = admin.firestore.FieldValue.serverTimestamp();
    console.log("Adding feedback");
    admin.firestore().collection("feedbacks").add(feedback);
  });
}

/**
 * Add all content attributes from openaiRequest and responseText to the "contents" collection
 * @param {string} openaiRequest the request sent to the OpenAI API
 * @param {string} openaiSystem the system definition sent to the OpenAI API
 * @param {string} rawResponseText the response from the OpenAI API call
 * @param {object} nlp the nlp document used for OpenAI API call
 * @param {object} nlpRef docement reference to the nlp document
 * @param {boolean} cached true if the response was cached
 */
function registerContents(openaiRequest, openaiSystem, rawResponseText, nlp, nlpRef, cached) {
  // remove new lines and extra spaces from the response
  const responseText = trimJsonString(rawResponseText);
  // parse the response to JSON, if the response is not in the expected format, try to fix it
  const responseJson = (function() {
    try {
      const jsonStart = responseText.indexOf("[{");
      const jsonEnd = responseText.lastIndexOf("}]") + 2;
      const jsonString = responseText.substring(jsonStart, jsonEnd);
      console.log("Response jsonString: ", jsonString);
      return JSON.parse(jsonString);
    } catch (error) {
      console.error(error);
      const jsonStart = responseText.indexOf("\"gender\"");
      const jsonEnd = responseText.lastIndexOf("\"}") + 2;
      const jsonString = "[{" + responseText.substring(jsonStart, jsonEnd) + "]";
      console.log("Fixed response jsonString: ", jsonString);
      return JSON.parse(jsonString);
    }
  })();
  console.log("JSON parsing successful");
  // cache the response in nlp document
  nlpRef.update({
    request: openaiRequest,
    system: openaiSystem,
    response: responseText,
    updated: admin.firestore.FieldValue.serverTimestamp(),
    chached: cached,
    successful: true,
  });
  responseJson.forEach((content) => {
    content.submission = nlp.content;
    content.created = admin.firestore.FieldValue.serverTimestamp();
    console.log("Adding content");
    // add a new document to the "contents" collection with nlpRef as a parent
    nlpRef.collection("contents").add(content);
  });
}

/**
 * Remove extra spaces and new lines around the brackets of the JSON String
 * @param {string} rawResponseText
 * @return {string} cleaned up JSON String
 */
function trimJsonString(rawResponseText) {
  return rawResponseText.
      replaceAll("\n", "").
      replaceAll("\r", "").
      replace(/\[\s*\{\s*/g, "[{").
      replace(/\s*\}\s*\]/g, "}]").
      replace(/\{\s*\{/g, "{{").
      replace(/\}\s*\}/g, "}}");
}

/**
 * Text from wikipedia page, to be cleaned up
 * @param {string} text from wikipedia page
 * @return {string} cleaned up text
 */
function removeWikiComments(text) {
  return text.replace(/\[.*\]/g, "");
}
