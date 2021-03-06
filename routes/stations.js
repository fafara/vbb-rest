'use strict'

const computeEtag = require('etag')
const serveBuffer = require('serve-buffer')
const autocomplete = require('vbb-stations-autocomplete')
const parse = require('cli-native').to
const {filterByKeys: createFilter} = require('vbb-stations')
const {data: stations, timeModified} = require('../lib/vbb-stations')
const toNdjsonBuf = require('../lib/to-ndjson-buf')

const JSON_MIME = 'application/json'
const NDJSON_MIME = 'application/x-ndjson'

const asJson = Buffer.from(JSON.stringify(stations), 'utf8')
const asJsonEtag = computeEtag(asJson)
const asNdjson = toNdjsonBuf(Object.entries(stations))
const asNdjsonEtag = computeEtag(asNdjson)

const err = (msg, statusCode = 500) => {
	const err = new Error(msg)
	err.statusCode = statusCode
	return err
}

const complete = (req, res, next, q, onStation, onEnd) => {
	const limit = q.results && parseInt(q.results) || 3
	const fuzzy = parse(q.fuzzy) === true
	const completion = parse(q.completion) !== false
	const results = autocomplete(q.query, limit, fuzzy, completion)

	const data = []
	for (const result of results) {
		const station = stations[result.id]
		if (!station) continue

		Object.assign(result, station)
		onStation(result)
	}
	onEnd()
}

const filter = (req, res, next, q, onStation, onEnd) => {
	const selector = Object.create(null)
	for (const prop in q) selector[prop] = parse(q[prop])
	const filter = createFilter(selector)

	for (const station of Object.values(stations)) {
		if (filter(station)) onStation(station)
	}
	onEnd()
}

const stationsRoute = (req, res, next) => {
	const t = req.accepts([JSON_MIME, NDJSON_MIME])
	if (t !== JSON_MIME && t !== NDJSON_MIME) {
		return next(err(JSON + ' or ' + NDJSON_MIME, 406))
	}

	res.setHeader('Last-Modified', timeModified.toUTCString())

	const head = t === JSON_MIME ? '{\n' : ''
	const sep = t === JSON_MIME ? ',\n' : '\n'
	const tail = t === JSON_MIME ? '\n}\n' : '\n'
	let i = 0
	const onStation = (s) => {
		const j = JSON.stringify(s)
		const field = t === JSON_MIME ? `"${s.id}":` : ''
		res.write(`${i++ === 0 ? head : sep}${field}${j}`)
	}
	const onEnd = () => {
		if (i > 0) res.end(tail)
		else res.end(head + tail)
	}

	const q = req.query
	if (Object.keys(q).length === 0) {
		const data = t === JSON_MIME ? asJson : asNdjson
		const etag = t === JSON_MIME ? asJsonEtag : asNdjsonEtag
		serveBuffer(req, res, data, {timeModified, etag})
	} else if (q.query) {
		complete(req, res, next, q, onStation, onEnd)
	} else {
		filter(req, res, next, q, onStation, onEnd)
	}
}

stationsRoute.queryParameters = {
	query: {
		description: 'Find stations by name using [`vbb-stations-autocomplete`](https://npmjs.com/package/vbb-stations-autocomplete).',
		type: 'string',
		defaultStr: '–',
	},
	limit: {
		description: '*If `query` is used:* Return at most `n` stations.',
		type: 'number',
		default: 3,
	},
	fuzzy: {
		description: '*If `query` is used:* Find stations despite typos.',
		type: 'boolean',
		default: false,
	},
	completion: {
		description: '*If `query` is used:* Autocomplete stations.',
		type: 'boolean',
		default: true,
	},
}

module.exports = stationsRoute
