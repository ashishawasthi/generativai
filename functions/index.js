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
exports.onCreateNlp = functions.runWith({secrets: [openAiApiKey]}).firestore.document("nlps/{nlpId}").onCreate((nlpSnap, context) => {
  const nlp = nlpSnap.data();
  const configuration = new Configuration({
    apiKey: openAiApiKey.value(),
  });
  const openai = new OpenAIApi(configuration);
  console.log("nlp.type: ", nlp.type);
  if (nlp.type && nlp.type === "feedback") {
    console.log("nlp.feedbacks: ", nlp.feedbacks);
    const openaiSystem = "You are customer relationship manager's assistant, analysing customer feedbacks for feedback's sentiment and topic.";
    let openaiRequest = "Topics of feedbacks can be: 'LivBetter' for carbon footprint, 'Nav Planner' for fianncial planning, 'Login', 'App Slowness', 'Insights' or 'General'.\nFor the following 2 items:\nitem 1: Nav Planner and Insights are very helpful.\nitem 2: Fingerprint login in failing.\nJSON response is:\n[{\"item\":1, \"analysis\":[{\"topic\":\"Nav Planner\",\"sentiment\":0.9},{\"topic\":\"Insights\",\"sentiment\":0.9}]},{\"item\":2, \"analysis\":[{\"topic\":\"Login\",\"sentiment\":-0.6}]}]\n\nCreate a JSON response for the following items:";
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
    const openaiAssistant1 = "[{\"gender\":\"male\",\"employment_status\":\"employed\",\"minimum_age\":25,\"maximum_age\":35,\"subject\":\"Pre-Approved Freedom Card\",\"body\":\"Dear {{first_name}},\n\nWe are pleased to inform you that you have been pre-approved for our new 'Freedom' card. Please click {{link}} to apply for your card.\"},{\"gender\":\"female\",\"employment_status\":\"unemployed\",\"minimum_age\":18,\"maximum_age\":25,\"subject\":\"Freedom Card for You!\",\"body\":\"Hi {{first_name}},\n\nOur 'Freedom' card has been pre-approved, for you to enjoy your financial freedom! Click{{link}} to apply\"}]";
    const openaiUser2 = "Content: " + nlp.content + "\nDemographics:\nmale. unemployed. age:18 to 25\nfemale. unemployed. age:18 to 25\nmale. employed. age:25 to 35\nfemale. employed. age:25 to 35\nmale. employed. age:35 to 45\nfemale. employed. age:35 to 45\nmale. employed. age:45 to 55\nfemale. employed. age:45 to 55\nmale. employed. age:55 to 65\nfemale. employed. age:55 to 65\nmale. retired. age:65 to 75\nfemale. retired. age:65 to 75";

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
exports.onCreateExtract = functions.runWith({secrets: [openAiApiKey]}).firestore.document("extracts/{extractId}").onCreate((extractSnap, context) => {
  const extract = extractSnap.data();

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
    });

    // call the OpenAI API to extract the facts from the text
    if (text) {
      const configuration = new Configuration({
        apiKey: openAiApiKey.value(),
      });
      const openai = new OpenAIApi(configuration);
      const openaiSystem = "You are an office assistant, extracting facts from documents";
      const openaiUser1 = "Extract facts from the following document:\n\n" + text;
      return openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {role: "system", content: openaiSystem},
          {role: "user", content: openaiUser1}],
      }).then((response) => {
        return extractSnap.ref.update({
          brief: response.data.choices[0].message.content,
          updated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }).catch(console.error);
    } else {
      console.log("No text to extract from");
      return;
    }
  }).catch(console.error);
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
