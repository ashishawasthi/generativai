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
    // console.log("nlp.feedbacks: ", nlp.feedbacks);
    const openaiSystem = "You are customer relationship manager's assistant. You analyse customer feedbacks for the topics and corresponding sentiments. You provide your analysis in JSON.";
    const openaiUser1 = "Topics:\nApp Slowness\nLogin\nInsights\nFianncial Planning or Nav Planner\nCarbon Footprint or LivBetter\nGeneral\n\n\nFeedback items:\nitem 1: Nav Planner is helpful. Insights is very helpful and actionable\nitem 2: Fingerprint login is failing";
    const openaiAssistant1 = "[{\"item\":1,\"analysis\":[{\"topic\":\"Fianncial Planning or Nav Planner\",\"sentiment\":0.7},{\"topic\":\"Insights\",\"sentiment\":0.9}]},{\"item\":2,\"analysis\":[{\"topic\":\"Login\",\"sentiment\":-0.7}]}]";
    let openaiUser2 = "Topics:";
    nlp.categories.forEach((category) => {
      openaiUser2 += "\n" + category;
    });
    openaiUser2 += "\nGeneral\n\n\nFeedback items:";
    nlp.feedbacks.forEach((feedback, index) => {
      openaiUser2 += "\nitem " + (index + 1) + ": " + feedback;
    });

    // query nlp collection, for existing feedback requests, if the request is same as the current request, return the response
    return admin.firestore().collection("nlps").where("request", "==", openaiUser2).where("successful", "==", true).get().then((matchSnap) => {
      if (matchSnap.empty) {
        console.log("Request not in cache, calling OpenAI ChatCompletion API");
        return openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [
            {role: "system", content: openaiSystem},
            {role: "user", content: openaiUser1},
            {role: "assistant", content: openaiAssistant1},
            {role: "user", content: openaiUser2}],
        }).then((response) => {
          return registerFeedbacks(
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
        return registerFeedbacks(
            openaiUser2,
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
    const openaiUser1 = "Type: Short email. \nContent: Freedom card pre-approved. no annual fee. 2X reward on travel. click {{link}} to apply.\nDemographics:\nmale. employed. age:25 to 35\nfemale. unemployed. age:18 to 25";
    const openaiAssistant1 = "[{\"gender\":\"male\",\"employment_status\":\"employed\",\"minimum_age\":25,\"maximum_age\":35,\"subject\":\"Pre-Approved Freedom Card with 2X Travel Rewards\",\"body\":\"Dear {{first_name}}, \n\nWe are pleased to inform you that you have been pre-approved for our new 'Freedom' card. Get 2X points on travel, and 1X points on all other purchases. Enjoy all these amazing perks without an annual fee. \n\nExperience the freedom of this Credit Card and unlock a world of rewards. Please click {{link}} to apply for your card. \n\nWarm regards,\"},{\"gender\":\"female\",\"employment_status\":\"unemployed\",\"minimum_age\":18,\"maximum_age\":25,\"subject\":\"Freedom Card with no annual fee and more rewards for You!\",\"body\":\"Hi {{first_name}}, \n\nOur 'Freedom' card has been pre-approved, for you to enjoy your financial freedom! \n\nGet rewards on all your purchases, with 2X points on your travel expenses. Enjoy all these amazing perks without an annual fee. \n\nDon't miss out on this fantastic opportunity to enhance your financial journey with a. click on {{link}} to apply! \n\nBest regards\"}]";
    let openaiUser2 = "Type: Long email. \nContent: " + nlp.content + "\nDemographics:";
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
        let text;
        // if wikipedia url, remove wiki comments
        if (extract.url.includes("wikipedia")) {
          text = $("div#mw-content-text").contents().map(function() {
            return (this.type === "text") ? $(this).text()+" " : "";
          }).get().join("");
          text = removeWikiComments(text);
        } else if (extract.url.includes("www.dbs")) {
          text = $("div#bodywrapper p").contents().map(function() {
            return (this.type === "text") ? $(this).text()+" " : "";
          }).get().join("");
        } else {
          // extract all text and URLs from the HTML
          text = $("body").contents().map(function() {
            return (this.type === "text") ? $(this).text()+" " : "";
          }).get().join("");
          // text = $("body p").text();
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
        if (text && words > 0) {
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
                console.log("Extract summary response jsonString: ", jsonString);
                return JSON.parse(jsonString);
              } catch (error) {
                console.error(error);
                const jsonStart = responseText.indexOf("\"summary\"");
                const jsonEnd = responseText.lastIndexOf("\"]") + 2;
                const jsonString = "{" + responseText.substring(jsonStart, jsonEnd) + "}";
                console.log("Fixed extract summary response jsonString: ", jsonString);
                return JSON.parse(jsonString);
              }
            })();
            extract["response"] = responseText;
            extract["updated"] = admin.firestore.FieldValue.serverTimestamp();
            extract["cached"] = false;
            return extractSnap.ref.update(extract);
          }).catch(console.error);
        } else {
          console.log("No text to extract summary from");
          return Promise.resolve();
        }
      }).catch((error) => {
        console.error("Error scraping URL: ", error);
        // update the document with 0 words
        extractSnap.ref.update({
          updated: admin.firestore.FieldValue.serverTimestamp(),
          words: 0,
          cached: false,
        });
        return Promise.resolve();
      });
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
        conversation: admin.firestore.FieldValue.arrayUnion("Bot: " + responseText + "\n"),
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
      console.log("Feedback response jsonString: ", jsonString);
      return JSON.parse(jsonString);
    } catch (error) {
      console.error(error);
      const jsonStart = responseText.indexOf("\"item\"");
      const jsonEnd = responseText.lastIndexOf("}]}") + 3;
      const jsonString = "[{" + responseText.substring(jsonStart, jsonEnd) + "]";
      console.log("Fixed feedback response jsonString: ", jsonString);
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

// onCreate function for the "epics" collection
exports.onCreateEpic = functions.runWith({secrets: [openAiApiKey], timeoutSeconds: 120}).firestore.document("epics/{epicId}").onCreate((epicSnap, context) => {
  const epic = epicSnap.data();
  console.log("epic: ", epic);
  // check if the requirement is already exists in epics collection
  return admin.firestore().collection("epics").where("requirement", "==", epic.requirement).where("response", "!=", "").get().then((matchSnap) => {
    if (matchSnap.empty) {
      console.log("No matching requirement in cache");
      const words = wordsCount(epic.requirement);
      // call the OpenAI ChatCompletion API
      if (epic.requirement && words > 0) {
        const configuration = new Configuration({
          apiKey: openAiApiKey.value(),
        });
        const openai = new OpenAIApi(configuration);
        const openaiSystem = "You are a technical product manager and solution architect. You write detailed technical user stories for given product requirements.\n\nThe Platform used for the product is AWS cloud. Following are the AWS services that can be used in the product:\n- Arbitration-Layer (proprietary channel routing engine for push to outbound channels, REST APIs for inbound channels)\n- T3 (proprietary data-lake, similar to AWS Athena)\n- T3-Feature-Mart (proprietary customer  model input data and metadata management)\n- Job-Server (proprietary platform for data processing and model inference, similar to AWS EMR)\n- Analytical-Cluster (proprietary data science work-bench, similar to AWS SageMaker)\n- Digi (proprietary mobile app and web app for customers)\n- API-Gateway\n- Data-Loader (for loading data from T3 to MariaDB)\n- CyberArk (for managing secrets)\n- Confluence Kafka (as real time event source)\n- MariaDB (as application database)\n- ReactJS (for UI)\n- AWS S3\n- AWS SageMaker (for AI model training and inference)\n- AWS EMR (for AI model training and inference)\n- AWS Lambda\n\nMention the users as 'Business user', 'System Developer' and other users if relevant e.g. 'Data Scientist', 'Analyst', 'Compliance Officer', 'Site Reliability Engineer'\n\nWrite detailed technical user stories in a JSON array with title, user, description and dependencies for each story.";
        const openaiUser1 = "Business Requirements:\nA self-service marketing rule-engine for business users to develop targeted marketing rules using AI model recommendations and customer data, including product-propensities, demographics, behavior, service usage, and transaction history. The platform ensures minimal spam and delivers messages via inbound and outbound channels. AI models provide product recommendations, predict propensities, optimize relevance, and align with revenue goals, while determining the best contact method, channels, timing, and content. Data is sourced from T3 for historical customer information and from Confluence Kafka for real-time customer events.";
        // eslint-disable-next-line quotes
        const openaiAssistant1 = '[{"title":"Marketing rules for targeted messages","user":"Business user","description":"As a business user, I want to create marketing rules based on AI model recommendations and customer data to deliver targeted messages via inbound and outbound channels. The rules should allow me to filter customers based on product-propensities, demographics, behavior, recent usage of services, and transaction history. The rules should also comply with regulatory requirements and prevent spamming customers. The system should provide a user-friendly interface to create, edit, and delete rules.","dependencies":["List of events to be available in the system.","Examples of complex conditions to be supported in rules. e.g. timeout between start and end events, event sequence.","List of spamming prevention rules."]},{"title":"Arbitration between inbound and outbound channels","user":"Business user","description":"As a business user, I want to create rules to arbitrate across all inbound and outbound channels. Inbound channels should include mobile apps, website and support calls. Outbound channels should include push-notes, email and SMS. The rules should allow me to specify the priority of channels and the conditions under which a channel should be used. The system should integrate with Arbitration-Layer and provide options to setup routing to one or multiple channels of Arbitration-Layer. Rules should be able to use a mix of AI model recommended touch points/channels, product/offer information and customer data to determine the best channel to contact a customer.","dependencies":["List of all inbound and outbound channels to support.","Types and examples of criteria to be supported"]},{"title":"Train AI models and monitor model performance over time","user":"Data Scientist","description":"As a data scientist, I want to train AI models to provide product recommendations, product propensities and content personalization. The system should provide a way to make training data available to Analytical-Cluster or AWS SageMaker to train the models. The system should also provide a way to update the models with new data and retrain them periodically.","dependencies":["Training data in T3-Feature-Mart should include customer demographics, behavior, service usage logs including Adobe/Google Analytics and customer transaction history.","Training data should be accessible in Analytical-Cluster or AWS SageMaker for training the models.","List of Model monitoring metrics. Definition of each metric.","Threshold values for each model monitoring metric, to raise alerts."]},{"title":"Integrate AI models into the rule engine system","user":"System Developer","description":"As a system developer, I want to integrate AI models into the rule engine system to predict product-propensity, maximizing relevance of products to customers and bank\'s revenue expectations. The AI models should predict the best way to contact a customer, determining the optimal channels, timing, and content. The system should provide REST APIs to access the real-time AI models in rule engine. The system should also provide batch scoring option on Job-Server or AWS EMR, where scores across all customers need to be calculated at the same time.","dependencies":["List of AI models. Inputs and outputs of each AI model","List of APIs. Inputs and outputs of each API","List of batch scoring jobs. Inputs and outputs of each job"]},{"title":"Measure campaign effectiveness using control groups","user":"Business user","description":"As a business user, I want to measure the effectiveness of campaigns using control groups. The system should provide a way to create control groups, assign them to campaigns and compare the results with the treatment groups. The system should generate reports with metrics such as conversion rate, revenue generated, and customer satisfaction.","dependencies":["List of metrics to be used for measuring campaign effectiveness.","Treatment group evaluation criteria for stratified sampling.","Types and examples of campaigns to be supported."]},{"title":"Handle high volumes and build fault-tolerant and resilient system","user":"System Developer","description":"As a system developer, I want to handle high volume and velocity of events and actions without compromising performance or reliability. The event handling should use scalable platforms like AWS Lambda and AWS SQS to process events asynchronously and scale up or down based on the load. The system should also use caching and load balancing for APIs to improve performance and reduce latency.","dependencies":["Maximum expected volume of events and actions.","Expected expect historical data to be loaded."]},{"title":"Secure and compliant system","user":"Compliance Officer","description":"As a compliance officer, I want to ensure that the system is secure and compliant with the bank\'s policies and regulations. The system should use CyberArk or AWS KMS to store keys to encrypt data at rest and in transit. The system should also use an APM like Splunk or AWS CloudTrail to monitor and audit system activity. The system should be regularly tested for vulnerabilities and compliance with the bank\'s policies and regulations.","dependencies":["List of compliance tests to be performed."]},{"title":"System monitoring dashboard","user":"Site Reliability Engineer","description":"As a site reliability engineer, I want to ensure that the system health is monitored and displayed on a live dashboard. There should be configurable thresholds for system metrics, to raise alarms and send notifications relevant SRE and development teams.""dependencies":["List of system metrics to be monitored.","List of alarms to be raised.","List of notifications to be sent."]}]';
        const openaiUser2 = "Business Requirements:\n" + epic.requirement;
        return openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          max_tokens: 2048,
          messages: [
            {role: "system", content: openaiSystem},
            {role: "user", content: openaiUser1},
            {role: "assistant", content: openaiAssistant1},
            {role: "user", content: openaiUser2},
          ],
        }).then((response) => {
          const responseText = response.data.choices[0].message.content.trim();
          console.log("Response text: ", responseText);
          epicSnap.ref.update({
            response: responseText,
            // stories: stories,
            testScenarios: "",
            processScenarios: false,
            cahed: false,
          });
          // parse the JSON response
          const stories = JSON.parse(responseText);
          console.log("stories length: " + stories.length);
          // add the stories to the child collection stories

          stories.forEach((story) => {
            story.created = admin.firestore.FieldValue.serverTimestamp();
            console.log("Adding story");
            epicSnap.ref.collection("stories").add(story);
          });
          return Promise.resolve();
        });
      } else {
        console.log("No requirement to process in the epic document");
      }
    } else {
      console.log("requirement already exists, using cached data");
      const match = matchSnap.docs[0].data();
      console.log("match.response: " + match.response);
      return epicSnap.ref.update({
        response: match.response,
        testScenarios: match.testScenarios,
        processScenarios: false,
        cached: true,
      }).then(() => {
        // create child collection of stories by copying the stories from the match epic
        const storiesRef = epicSnap.ref.collection("stories");
        return storiesRef.get().then((storiesSnap) => {
          if (storiesSnap.empty) {
            console.log("No stories found in the new epic, copying stories from cached epic");
            const matchStoriesRef = matchSnap.docs[0].ref.collection("stories");
            return matchStoriesRef.get().then((matchStoriesSnap) => {
              matchStoriesSnap.docs.forEach((doc) => {
                const story = doc.data();
                story.created = admin.firestore.FieldValue.serverTimestamp();
                console.log("Adding cached story");
                epicSnap.ref.collection("stories").add(story);
              });
              return Promise.resolve();
            });
          } else {
            console.log("Stories already exist in the cache");
            return Promise.resolve();
          }
        }); // end of storiesRef.get()
      }); // end of epicSnap.ref.update()
    } // end of if (matchSnap.empty)
  }).catch(console.error);
});

// onUpdate function for the "epics" collection to generate test scenarios
exports.onUpdateEpic = functions.runWith({secrets: [openAiApiKey]}).firestore.document("epics/{epicId}").onUpdate((change, context) => {
  const epic = change.after.data();
  // query child collection stories with epic reference
  const storiesRef = change.after.ref.collection("stories");
  return storiesRef.get().then((storiesSnap) => {
    const stories = storiesSnap.docs.map((doc) => doc.data().story);
    if (stories && stories.length > 0 && epic.processScenarios) {
      console.log(stories.length + " stories Found. Creating test scenarios for epic");
      // join all description elements inside the items in stories array, using new line as separator
      const descriptions = stories.filter((story) => story && story.description).map((story) => story.description).join("\n");
      console.log("Story descriptions: " + descriptions);
      const openaiSystem = "You are a software product QA team member, writing test scenarios for a given epic and user stories.";
      const openaiUser1 = "Write test scenarios\n\nRequirement:\n" + epic.requirement + "\n\nUser Stories:\n" + descriptions;
      // call the OpenAI ChatCompletion API
      const configuration = new Configuration({
        apiKey: openAiApiKey.value(),
      });
      const openai = new OpenAIApi(configuration);
      return openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {role: "system", content: openaiSystem},
          {role: "user", content: openaiUser1}],
      }).then((response) => {
        const responseText = response.data.choices[0].message.content.trim();
        console.log("Response text: ", responseText);
        // update the epic document with the response
        return change.after.ref.update({
          testScenarios: responseText,
          processScenarios: false,
        });
      }).catch((error) => {
        console.error(error);
        return change.after.ref.update({
          processScenarios: false,
        });
      });
    } else {
      console.log("No stories to process in the epic document");
      return change.after.ref.update({
        processScenarios: false,
      });
    }
  }).catch((error) => {
    console.error(error);
    return change.after.ref.update({
      processScenarios: false,
    });
  });
});

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
