const osc = require('osc')
const sharp = require('sharp')
const http = require('http')
const path = require('path')
const fs = require('fs')

//send queries to the qlab instance

const oscDestination = '127.0.0.1'
const oscDestinationPort = 53000

const httpReceivePort = 1103

const slideshowDelay = 10*1000 //Time between each new picture/title combination

let slideshowRunning = false

//Ikke se her beklager
let pictureCuesOccupied = [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]



function initApp() {
    //Check Qlab response for active?
    //Start background graphic
    activateOrDeactiveQue(3, true)
    //Populate title queues and choices size
    populateTitleChoices()
}

initApp()



//------OSC PART, COMMUNICATES WITH QLAB--------//


//SETUP OSC

const oscPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 53001,
    metadata: true
});

oscPort.on("ready", () => {
    console.log("OSC ready")
})

oscPort.on('error', console.error)

oscPort.open()

//PICTURES IN QLAB

function calculatePictureCueOffset(pictureNumber) {
    return 100 + pictureNumber + 1
}

function calculateTitleCueOffset(titleNumber) {
    return 200 + titleNumber + 1
}

function addPicturePreShow (pictureFilePath) {
    for (let i = 0; i < pictureCuesOccupied.length; i++) {
        if(pictureCuesOccupied[i]) continue

        pictureCuesOccupied[i] = true
        sendOscToQLab(calculatePictureCueOffset(i), "fileTarget", pictureFilePath)
        pictureChoices++
        return
    }
    console.error("Tried to add new picture to an empty que, but all ques are full!")
}

function deleteAllPicturesPreShow() {
    console.log("Deleting all pre-show pictures")

    for (let i = 0; i < pictureCuesOccupied.length; i++) {
        pictureCuesOccupied[i] = false
        sendOscToQLab(calculatePictureCueOffset(i), "fileTarget", "nothing")
    }

    pictureChoices = 0
}

function setPictureInShow (pictureFilePath) {
    sendOscToQLab(5, 'fileTarget', pictureFilePath)
}

function deletePictureInShow() {
    sendOscToQLab(5, 'fileTarget', "nothing")
}


//PRE SHOW SLIDESHOW

let pictureChoices = 0
let titleChoices = 0
let picturePaths = []
let titlePaths = []

let lastPictureQue = -1
let lastTitleQue = -1

let usedPictures = []
let usedTitles = []

function startSlideshow() {
    slideshowRunning = true
    populateTitleChoices().then(() => tickSlideshow)
}

function stopSlideshow() {
    slideshowRunning = false
}

async function tickSlideshow() {
    if(!slideshowRunning) return;
    //send

    let pictureChoice = Math.floor(Math.random() * pictureChoices)
    while (usedPictures.includes(pictureChoice)) pictureChoice = Math.floor(Math.random() * pictureChoices)

    let titleChoice = Math.floor(Math.random() * titleChoices)
    while (usedTitles.includes(titleChoice)) titleChoice = Math.floor(Math.random() * titleChoices)

    activateOrDeactiveQue(lastPictureQue, false)
    lastPictureQue = calculatePictureCueOffset(pictureChoice)
    activateOrDeactiveQue(lastPictureQue, true)

    activateOrDeactiveQue(lastTitleQue, false)
    lastTitleQue = calculateTitleCueOffset(titleChoice)
    activateOrDeactiveQue(lastTitleQue, true)

    if(usedPictures.length === pictureChoices - 1) {
        usedPictures = []
    }

    if(usedTitles.length === titleChoices - 1) {
        usedTitles = []
    }

    setInterval(tickSlideshow, slideshowDelay)
}


//QLAB UTIL

function activateOrDeactiveQue(cue, activate) {
    console.log("sending " + (activate ? 'go' : 'stop') + " to " + cue)
    oscPort.send({
        address: '/cue/' + cue + '/' + (activate ? 'go' : 'stop')
    })
}

function sendOscToQLab(cue, command, arg) {
    console.log("Sending " + command + " to " + cue + " with " + arg)
    oscPort.send({
        address: '/cue/' + cue + '/' + command,
        args: [{
            type: 's',
            value: arg
        }]
    }, oscDestination, oscDestinationPort)
}


async function populateTitleChoices() {
    let dirpath = path.join(__dirname, "resources", "titles")
    fs.readdir(dirpath, function (err, files) {
        if(err) {
            console.error("Unable to read directory with TITLES from pre show. " + err)
        }

        titlePaths = []
        files.forEach(function (file) {
            titlePaths.push(path.join(dirpath, file)) //TODO check that file is file name
        })
        titleChoices = titlePaths.length
    })

    for (let i = 0; i < titlePaths.length; i++) {
        sendOscToQLab(calculateTitleCueOffset(i), "fileTarget", titlePaths[i])
    }
}


//---------HTTP PART, COMMUNICATING WITH APP---------//

const server = http.createServer(function (req, res) {

    if (req.url === '/deletepictures') {
        deleteAllPicturesPreShow() //Pre show pictures
    }

    if (req.url === '/deletepictureandtitle') {
        sendOscToQLab(2, 'text', " ") //Removes title
        deletePictureInShow()
    }

    if (req.url === '/postpicturepre') {
        let pict = Buffer.alloc(0)
        req.on('data', function (chunk) {
            pict = Buffer.concat([pict, chunk])
        })
        let pictureName;
        req.on(('end'), () => sharp(pict).flip(true).flop(true).toFile(pictureName, console.log))
        addPicturePreShow(path.join(__dirname, "resources/picturespreshow/" + pictureName))
    }

    if(req.url === '/postpicturein') {
        let pict = Buffer.alloc(0)
        req.on('data', function (chunk) {
            pict = Buffer.concat([pict, chunk])
        })
        req.on(('end'), () => sharp(pict).flip(true).flop(true).toFile('inshowpic.jpg', console.log))
        setPictureInShow(path.join(__dirname, "resources/picturesinshow/inshowpic.jpg"))
    }

    if (req.url === '/posttitle') {
        req.setEncoding('utf8')
        req.on('data', function (body) {
            sendOscToQLab(2, 'text', body)
        })

    }

    res.end()


    //console.log(req)
})

server.listen(httpReceivePort)

server.on('listening', function () {
    console.log("http server is listening on port " + httpReceivePort)
})

server.on('error', console.error)