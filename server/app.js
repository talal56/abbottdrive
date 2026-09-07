require('dotenv').config()
const express = require('express')
const cors = require('cors')
const connectDB = require('./config/db')

const app = express()

app.use(cors())
app.use(express.json())

connectDB()

const PORT = process.env.PORT||5000

app.listen(PORT, '0.0.0.0' ,()=>{
    console.log(`Server running on http://localhost:${PORT}`)
}) 