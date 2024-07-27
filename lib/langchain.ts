import { ChatOpenAI } from "@langchain/openai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import pineconeClient from "./pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { PineconeConflictError } from "@pinecone-database/pinecone/dist/errors";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { adminDb } from "@/firebaseAdmin";
import { auth } from "@clerk/nextjs/server";
import { describeIndexStats } from "@pinecone-database/pinecone/dist/data/describeIndexStats";

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
});

export const indexName = "chatpdfnextai";

async function fetchMessagesFromDB(docId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User Not Found");
  }
  console.log("fetching chat history from firestore database");

  const chats = await adminDb
    .collection("users")
    .doc(userId)
    .collection("files")
    .doc(docId)
    .collection("chat")
    .orderBy("createdAt", "desc")
    // .limit(7)
    .get();

  const chatHistory = chats.docs.map((doc) =>
    doc.data().role === "human"
      ? new HumanMessage(doc.data().message)
      : new AIMessage(doc.data().message)
  );

  return chatHistory;
}

export async function generateDocs(docId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not found");
  }

  console.log("fetching download url from firebase");
  const firebaseRef = await adminDb
    .collection("users")
    .doc(userId)
    .collection("files")
    .doc(docId)
    .get();

  const downloadUrl = firebaseRef.data()?.downloadUrl;

  if (!downloadUrl) {
    throw new Error("download Url is not found");
  }

  console.log(`download url of pdf ${downloadUrl}`);

  //   fetch the pdf from the url of firestore firebase
  const response = await fetch(downloadUrl);

  //   Load the Pdf into PdfDocumentObject
  const data = await response.blob();

  //   load the pdf document from the specified path
  console.log("loading PDF document");
  const loader = new PDFLoader(data);
  const docs = await loader.load();

  // Split the documents into samller parts fro processing
  console.log("splitting documents into smaller parts");
  const splitter = new RecursiveCharacterTextSplitter();
  const splitDocs = await splitter.splitDocuments(docs);
  console.log(`documents is split into ${docs.length} equal parts`);

  return splitDocs;
}

async function namespaceExists(
  index: Index<RecordMetadata>,
  namespace: string
) {
  if (namespace === null) throw new Error("No namespace value is provided");
  //   @ts-ignore
  const { namespaces } = await describeIndexStats();
  return namespaces?.[namespace] !== undefined;
}

export async function generateEmbeddingsInPineconeVectorStore(docId: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("User not found");
  }

  let pineconeVectorStore;

  console.log("generate embeddings");
  const embeddings = new OpenAIEmbeddings();

  const index = await pineconeClient.index(indexName);
  const namespaceAlreadyExists = await namespaceExists(index, docId);

  if (namespaceAlreadyExists) {
    console.log(`${docId} already exists will reuse exsisting embeddings`);

    pineconeVectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: docId,
    });

    return pineconeVectorStore;
  } else {
    // if the namespsce does not exsist download the pdf from firestore via download url & generate embeddings and store them in pinecone vector space

    const splitDocs = await generateDocs(docId);
    console.log(
      `storing the embeddings in the ${docId} in the ${indexName} Pinecone space`
    );

    pineconeVectorStore = await PineconeStore.fromDocuments(
      splitDocs,
      embeddings,
      {
        pineconeIndex: index,
        namespace: docId,
      }
    );

    return pineconeVectorStore;
  }
}

const generateLangchainCompletion = async (docId: string, question: string) => {
  let pineconeVectoreStore;

  pineconeVectoreStore = await generateEmbeddingsInPineconeVectorStore(docId);

  if (!pineconeVectoreStore) {
    throw new Error("Pinecone vector store not found");
  }

  // create a retriver to search through vector store
  console.log("creating a retriver");

  const retriever = pineconeVectoreStore.asRetriever();

  //  Fetch the chat history from DB
  const chatHistory = await fetchMessagesFromDB(docId);

  // Prompt template for questions based on search history
  console.log("defining prompt template");
  const historyAwarePrompt = ChatPromptTemplate.fromMessages([
    ...chatHistory,
    ["user", "{input}"],
    [
      "user",
      "Given the above conversation , generate a search query to look up in order to get information releavent to the conversation",
    ],
  ]);

  // create a history aware retriver chain
  const historyAwareRetrieverChain = await createHistoryAwareRetriever({
    llm: model,
    retriever,
    rephrasePrompt: historyAwarePrompt,
  });

  // prompt template for answering qusetions b

  const historyAwareRetrievalPrompt = await ChatPromptTemplate.fromMessages([
    [
      "system",
      "Answer the user's question based on below context:\n\n{context}",
    ],
    ...chatHistory,
    ["user", "{input}"],
  ]);

  // create a chain to combine the retrived document into coherent response
  const historyAwareCombineDocsChain = await createStuffDocumentsChain({
    llm: model,
    prompt: historyAwareRetrievalPrompt,
  });

  // create the main retrival chain that combine the history aware retriver and document combning chains
  const conversationalRetrievalChain = await createRetrievalChain({
    retriever: historyAwareRetrieverChain,
    combineDocsChain: historyAwareCombineDocsChain,
  });

  const reply = await conversationalRetrievalChain.invoke({
    chat_history: chatHistory,
    input: question,
  });

  return reply.answer;
};

export { model, generateLangchainCompletion };
