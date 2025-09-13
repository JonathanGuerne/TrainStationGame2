const btnIntro = document.getElementById("btn-intro");
const btnBackIntro = document.getElementById("btn-back-intro");
const gameArticle = document.getElementById("game-article");
const introArticle = document.getElementById("intro-article");
const departureStationDiv = document.getElementById("departure-station");
const departureTimeDiv = document.getElementById("departure-time");
const departurePlatformDiv = document.getElementById("departure-platform");
const arrivalStationDiv = document.getElementById("arrival-station");
const arrivalTimeDiv = document.getElementById("arrival-time");
const arrivalPlatformDiv = document.getElementById("arrival-platform");
const btnReloadTrain = document.getElementById("btn-reload-train");
const sectionError = document.getElementById("error-section");
const sectionTrainDetails = document.getElementById("train-details-section");
const sectionLoading = document.getElementById("loading-section");
const btnValidateTrain = document.getElementById("btn-validate-train");
const btnClearJourney = document.getElementById("btn-clear-journey");
const ulJourneyList = document.getElementById("journey-info-list");

type TrainStationResponse = {
  stations: TrainStation[];
};

type TrainStationBoardEntry = {
  capacity1st: number;
  capacity2nd: number;
  category: string;
  categoryCode: string;
  name: string;
  number: string;
  operator: string;
  to: string;
  stop: {
    arrival: string | null;
    arrivalTimestamp: number | null;
    delay: number | null;
    departure: string;
    departureTimestamp: number;
    platform: string | null;
  };
  passList: {
    station: {
      id: string;
      name: string | null;
    };
    arrival: string | null;
    arrivalTimestamp: number | null;
    departure: string | null;
    delay: number | null;
    departureTimestamp: number | null;
    platform: string | null;
    capacity1st: number | null;
    capacity2nd: number | null;
  }[];
};

type TrainStationWithBoardResponse = {
  stationboard: TrainStationBoardEntry[];
  station: {
    id: string;
    name: string | null;
  };
};

type TrainStation = {
  name: string;
  id: string;
  icon: string;
  coordinate: { type: string; x: number; y: number };
  distance: number;
};

type TrainJourneyInfo = {
  departureStation: string;
  departureTime: string;
  departurePlatform: string | null;
  arrivalStation: string;
  arrivalTime: string;
  arrivalPlatform: string | null;
};

btnIntro?.addEventListener("click", () => {
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.removeAttribute("hidden");
  updateUITrain();
});

btnReloadTrain?.addEventListener("click", () => {
  updateUITrain();
});

btnValidateTrain?.addEventListener("click", () => {
  const currentJourneyInfo = getCookieJourneyInfo();
  // should be a list but could be empty
  if (!currentJourneyInfo) {
    return;
  }

  const newJourneyInfo = [...currentJourneyInfo];
  const newEntry: TrainJourneyInfo = {
    departureStation: departureStationDiv?.innerText || "N/A",
    departureTime: departureTimeDiv?.innerText || "N/A",
    departurePlatform: departurePlatformDiv?.innerText || "N/A",
    arrivalStation: arrivalStationDiv?.innerText || "N/A",
    arrivalTime: arrivalTimeDiv?.innerText || "N/A",
    arrivalPlatform: arrivalPlatformDiv?.innerText || "N/A",
  };
  newJourneyInfo.push(newEntry);
  setCookieJourneyInfo(newJourneyInfo);
  updateUIJourneyListInfo();
});

btnClearJourney?.addEventListener("click", () => {
  // remove the cookie by setting its expiration date to the past
  document.cookie = "journeyInfo=; path=/; max-age=0";
  updateUIJourneyListInfo();
});

function updateUITrain() {
  sectionError?.setAttribute("hidden", "true");
  sectionTrainDetails?.setAttribute("hidden", "true");
  sectionLoading?.removeAttribute("hidden");
  updateTrainInfo()
    .then(() => {
      sectionLoading?.setAttribute("hidden", "true");
      sectionTrainDetails?.removeAttribute("hidden");
    })
    .catch((error) => {
      sectionLoading?.setAttribute("hidden", "true");
      sectionError?.removeAttribute("hidden");
      console.error("Error updating train info:", error);
    });
  updateUIJourneyListInfo();
}

function updateUIJourneyListInfo() {
  if (!ulJourneyList) {
    return;
  }
  // clear existing list
  ulJourneyList.innerHTML = "";
  const journeyInfo = getCookieJourneyInfo();
  if (!journeyInfo || journeyInfo.length === 0) {
    return;
  }
  // create a fragment to avoid multiple reflows
  const fragment = document.createDocumentFragment();
  journeyInfo.forEach((info) => {
    const li = document.createElement("li");
    li.innerText = `From ${info.departureStation} at ${info.departureTime} on platform ${info.departurePlatform} to ${info.arrivalStation} at ${info.arrivalTime} on platform ${info.arrivalPlatform}`;
    fragment.appendChild(li);
  });
  ulJourneyList?.appendChild(fragment);
}

btnBackIntro?.addEventListener("click", () => {
  gameArticle?.setAttribute("hidden", "true");
  introArticle?.removeAttribute("hidden");
});

async function getCurrentPlayerGPSLocation(): Promise<[number, number]> {
  if (!navigator.geolocation) {
    throw new Error("Geolocation is not supported by this browser.");
  }
  return new Promise<[number, number]>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((position) => {
      resolve([position.coords.latitude, position.coords.longitude]);
    }, reject);
  });
}

async function fetchTrainStationData(
  lat: number,
  lon: number
): Promise<TrainStation | undefined> {
  const response = await fetch(
    `https://transport.opendata.ch/v1/locations?x=${lon}&y=${lat}&type=station`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch train data.");
  }
  const stations: TrainStationResponse = await response.json();
  if (!stations.stations || stations.stations.length === 0) {
    return undefined;
  }
  console.log("Fetched Stations:", stations);

  stations.stations.sort((a, b) => a.distance - b.distance);

  // icon must be equals to "train"
  return stations.stations.find((station) => station.icon === "train");
}

async function fetchNextTrain(
  stationId: string
): Promise<TrainStationBoardEntry[] | undefined> {
  const response = await fetch(
    `https://transport.opendata.ch/v1/stationboard?id=${stationId}&limit=10`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch next train data.");
  }
  const data: TrainStationWithBoardResponse = await response.json();
  const boardEntries = data.stationboard;
  if (!boardEntries || boardEntries.length === 0) {
    return undefined;
  }
  return boardEntries;
}

function getRandomTrainJourney(
  depatureStation: TrainStation,
  possibilities: TrainStationBoardEntry[]
): TrainJourneyInfo {
  // fetch a random train from possibilities
  const randomIndex = Math.floor(Math.random() * possibilities.length);
  const selectedTrain = possibilities[randomIndex];

  if (!selectedTrain || selectedTrain.passList.length === 0) {
    throw new Error("No valid train found.");
  }

  // fetch a random passList entry from selectedTrain
  const passList = selectedTrain.passList;

  // destination index must not be 0 (the departure station)
  const departurePass = passList[0];
  if (!departurePass || !departurePass.departure || !departurePass.platform) {
    throw new Error("No valid departure found.");
  }
  const filteredPassList = passList.slice(1);
  if (filteredPassList.length === 0) {
    throw new Error("No valid destination found.");
  }

  const randomPassIndex = Math.floor(Math.random() * filteredPassList.length);
  const selectedPass = filteredPassList[randomPassIndex];
  console.log("Selected Pass:", selectedPass);
  if (
    !selectedPass ||
    !selectedPass.arrival ||
    !selectedPass.station ||
    !selectedPass.station.name
  ) {
    throw new Error("No valid destination found.");
  }

  return {
    departureStation: depatureStation.name,
    departureTime: departurePass.departure,
    departurePlatform: departurePass.platform,
    arrivalStation: selectedPass.station.name,
    arrivalTime: selectedPass.arrival,
    arrivalPlatform: selectedPass.platform,
  };
}

async function updateTrainInfo(): Promise<void> {
  const [lat, lon] = await getCurrentPlayerGPSLocation();
  const trainData = await fetchTrainStationData(lat, lon);
  if (!trainData) {
    throw new Error("No train station found nearby.");
  }
  const nextTrainData = trainData ? await fetchNextTrain(trainData.id) : null;
  if (!nextTrainData) {
    throw new Error("No next train data found.");
  }
  const journeyInfo = getRandomTrainJourney(trainData, nextTrainData);
  // replace inner text of departure-station, departure-time, departure-platform, arrival-station, arrival-time, arrival-platform
  if (departureStationDiv) {
    departureStationDiv.innerText = journeyInfo.departureStation;
  }
  if (departureTimeDiv) {
    departureTimeDiv.innerText = journeyInfo.departureTime;
  }
  if (departurePlatformDiv) {
    departurePlatformDiv.innerText =
      journeyInfo.departurePlatform?.toString() || "N/A";
  }
  if (arrivalStationDiv) {
    arrivalStationDiv.innerText = journeyInfo.arrivalStation;
  }
  if (arrivalTimeDiv) {
    arrivalTimeDiv.innerText = journeyInfo.arrivalTime;
  }
  if (arrivalPlatformDiv) {
    arrivalPlatformDiv.innerText =
      journeyInfo.arrivalPlatform?.toString() || "N/A";
  }
}

function getCookieJourneyInfo(): TrainJourneyInfo[] {
  // first we check if cookies are enabled
  if (!navigator.cookieEnabled) {
    return [];
  }
  // we check if the cookie "journeyInfo" exists and if yes we retrieve it
  const cookies = document.cookie.split("; ");
  const journeyInfoCookie = cookies.find((cookie) =>
    cookie.startsWith("journeyInfo=")
  );
  if (!journeyInfoCookie) {
    return [];
  }
  const cookieValue = journeyInfoCookie.split("=")[1];
  if (!cookieValue) {
    return [];
  }
  try {
    const journeyInfo: TrainJourneyInfo[] = JSON.parse(
      decodeURIComponent(cookieValue)
    );
    return journeyInfo;
  } catch (error) {
    return [];
  }
}

function setCookieJourneyInfo(journeyInfo: TrainJourneyInfo[]): void {
  // first we check if cookies are enabled
  if (!navigator.cookieEnabled) {
    throw new Error("Cookies are not enabled.");
  }
  // we check if the cookie "journeyInfo" exists and if yes we retrieve it
  const cookieName = "journeyInfo";
  const cookieValue = JSON.stringify(journeyInfo);
  document.cookie = `${cookieName}=${cookieValue}; path=/; max-age=86400`; // 1 day
}
