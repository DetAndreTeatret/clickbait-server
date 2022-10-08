const osc = require('osc')
const sharp = require('sharp')
const http = require('http')
const path = require('path')
const fs = require('fs')
const uuid = require('crypto')

const oscDestinationIP = '127.0.0.1'
const oscDestinationPort = 53000

const httpReceivePort = 1103

const slideshowDelay = 5*1000 //Time between each new picture/title combination (in ms)

let slideshowRunning = false

//Ikke se her beklager
let pictureCuesOccupied = [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]

//IMPORTANT CUE NUMBERS
const inShowPictureCue = 5
const dynamicTitleCue = 2
const backgroundGraphicCue = 3

const preShowPictureCueOffset = 100
const preShowTitleCueOffset = 200

function initApp() {
    console.log("Initializing ClickbaitServer...")
    //Check Qlab response for active?
    //Start background graphic
    //activateOrDeactiveQue(backgroundGraphicCue, true)
    sendOscToQLab(dynamicTitleCue, "text", " ")
    //activateOrDeactiveQue(dynamicTitleCue, true)
    //Populate title queues and choices size
    populateTitleChoices()
}


//------OSC PART, COMMUNICATES WITH QLAB--------//


//SETUP OSC

const oscPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: 53001,
    metadata: true
});

// Listen for incoming OSC messages.
oscPort.on("message", function (oscMsg, timeTag, info) {
    console.log("OSC from QLab with address " + oscMsg["address"] + " received with status " + JSON.parse(oscMsg["args"][0]["value"])["status"].toUpperCase())
    //console.log("Remote info is: ", info);
});

oscPort.on('error', console.error)

oscPort.on("ready", () => {
    console.log("OSC server ready")
    oscPort.send({
        address: '/alwaysReply',
        args: [{
         type:'f',
         value: 1
        }]
    }, oscDestinationIP, oscDestinationPort)
    initApp()
})

oscPort.open()

//PICTURES IN QLAB

function calculatePictureCueOffset(pictureNumber) {
    return preShowPictureCueOffset + (pictureNumber + 1) //Anti zero index
}

function calculateTitleCueOffset(titleNumber) {
    return preShowTitleCueOffset + (titleNumber + 1) //Anti zero index
}

function addPicturePreShow (pictureFilePath) {
    for (let i = 0; i < pictureCuesOccupied.length; i++) {
        if(i !== 0 && !slideshowRunning){
            startSlideshow()
        }

        if(pictureCuesOccupied[i]) {
            continue
        }

        pictureCuesOccupied[i] = true
        sendOscToQLab(calculatePictureCueOffset(i), "fileTarget", pictureFilePath)
        pictureChoices++

        if(i === 0) {
            activateOrDeactiveQue(calculatePictureCueOffset(i), true)
        }
        return
    }
    console.error("Tried to add new picture to an empty que, but all ques are full!")
    console.error(pictureCuesOccupied)
}

function deleteAllPicturesPreShow() {
    console.log("Deleting all pre-show pictures!!!!")

    for (let i = 0; i < pictureCuesOccupied.length; i++) {
        pictureCuesOccupied[i] = false
        //sendOscToQLab(calculatePictureCueOffset(i), "fileTarget", "nothing")
    }

    pictureChoices = 0
}

function setPictureInShow (pictureFilePath) {
    sendOscToQLab(inShowPictureCue, 'fileTarget', pictureFilePath)
}

function deletePictureInShow() {
    activateOrDeactiveQue(inShowPictureCue, false)

    fs.rm(path.join(__dirname, "inshowpic.jpg"), () => {})
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
    if(slideshowRunning === true) {
        console.log("Slideshow already running....")
        return;
    }

    console.log("Starting slideshow....")
    slideshowRunning = true
    tickSlideshow()
}

function stopSlideshow() {
    console.log("Stopping slideshow....")
    slideshowRunning = false
}

async function tickSlideshow() {
    if(!slideshowRunning){
        activateOrDeactiveQue(lastPictureQue, false)
        if(lastTitleQue !== -1) activateOrDeactiveQue(lastTitleQue, false)
        console.log("Slideshow stopped!")
        return;
    }
    console.log("Ticking slideshow!")


    let pictureChoice = Math.floor(Math.random() * pictureChoices)
    while (usedPictures.includes(pictureChoice)) pictureChoice = Math.floor(Math.random() * pictureChoices)



    activateOrDeactiveQue(lastPictureQue === -1 ? 101 : lastPictureQue, false)
    lastPictureQue = calculatePictureCueOffset(pictureChoice)
    activateOrDeactiveQue(lastPictureQue, true)

    if(usedPictures.length === pictureChoices - 1) {
        usedPictures = []
    }

    if(titleChoices !== 0) {
        let titleChoice = Math.floor(Math.random() * titleChoices)
        while (usedTitles.includes(titleChoice)) titleChoice = Math.floor(Math.random() * titleChoices)

        if(lastTitleQue !== -1) {
            activateOrDeactiveQue(lastTitleQue, false)
        }
        lastTitleQue = calculateTitleCueOffset(titleChoice)
        activateOrDeactiveQue(lastTitleQue, true)

        if(usedTitles.length === titleChoices - 1) {
            usedTitles = []
        }
    }


    setTimeout(tickSlideshow, slideshowDelay)
}


//QLAB UTIL

function activateOrDeactiveQue(cue, activate) {
    console.log("Sending /cue/" + cue + "/" + (activate ? 'go' : 'stop'))
    oscPort.send({
        address: '/cue/' + cue + '/' + (activate ? 'go' : 'stop')
    }, oscDestinationIP, oscDestinationPort)
}

function sendOscToQLab(cue, command, arg) {
    console.log("Sending " + "/cue/" + cue + '/' + command + " " + arg)
    oscPort.send({
        address: '/cue/' + cue + '/' + command,
        args: [{
            type: 's',
            value: arg
        }]
    }, oscDestinationIP, oscDestinationPort)
}


async function populateTitleChoices() {
    let dirpath = path.join(__dirname, "/resources/titles")
    fs.readdir(dirpath, function (err, files) {
        if(err) {
            console.error("Unable to read directory with TITLES from pre show. " + err)
        }

        titlePaths = []
        files.forEach(function (file) {
            titlePaths.push(path.join(dirpath, file)) //TODO check that file is file name
        })
        titleChoices = titlePaths.length

        console.log("Found " + titleChoices + " titles, adding them to QLab")
        console.log(files)

        for (let i = 0; i < titlePaths.length; i++) {
            sendOscToQLab(calculateTitleCueOffset(i), "fileTarget", titlePaths[i])
        }
    })
}


//---------HTTP PART, COMMUNICATING WITH APP---------//

const server = http.createServer(function (req, res) {

    if (req.url === '/deletepictures') {
        stopSlideshow()
        deleteAllPicturesPreShow() //Pre show pictures
    }

    if (req.url === '/deletepictureandtitle') {
        sendOscToQLab(dynamicTitleCue, 'text', " ") //Removes title
        deletePictureInShow()
    }

    if (req.url === '/postpicturepre') {
        let pict = Buffer.alloc(0)
        req.on('data', function (chunk) {
            pict = Buffer.concat([pict, chunk])
        })
        let pictureName = uuid.randomUUID() + ".jpg"
        req.on(('end'), () => {
            sharp(pict).flip(true).flop(true).toFile(pictureName, function (err, info) {
                if(err) {
                    console.error(err)
                }
                console.log("Image received for pre-show!")
                console.log(info)
                addPicturePreShow(path.join("~/WebstormProjects/clickbait-server", pictureName))
            })
        })
    }

    if(req.url === '/postpicturein') {
        deletePictureInShow()
        let pict = Buffer.alloc(0)
        req.on('data', function (chunk) {
            pict = Buffer.concat([pict, chunk])
        })
        req.on(('end'), () => {
            sharp(pict).flip(true).flop(true).toFile('inshowpic.jpg', function (err, info) {
                if(err) {
                    console.error(err)
                }
                console.log("Image received for in show!")
                console.log(info)
                setPictureInShow(path.join(__dirname, "inshowpic.jpg"))
                activateOrDeactiveQue(inShowPictureCue, true)
            })
        })

    }

    if (req.url === '/posttitle') {
        req.setEncoding('utf8')
        req.on('data', function (body) {
            sendOscToQLab(dynamicTitleCue, 'text', body)

        })

    }

    res.end()


    //console.log(req)
})

server.listen(httpReceivePort)

server.on('listening', function () {
    console.log("HTTP server is listening on port " + httpReceivePort)
})

server.on('error', console.error)