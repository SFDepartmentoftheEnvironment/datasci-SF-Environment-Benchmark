"use strict";

//TODO: CHANGE limit on returned properties in function propertyTypeQuery()
const DATASOURCE = '75rg-imyz' // 'j2j3-acqj'
const METRICS = ['benchmark','energy_star_score','site_eui_kbtu_ft2','source_eui_kbtu_ft2','percent_better_than_national_median_site_eui','percent_better_than_national_median_source_eui','total_ghg_emissions_metric_tons_co2e','total_ghg_emissions_intensity_kgco2e_ft2','weather_normalized_site_eui_kbtu_ft2','weather_normalized_source_eui_kbtu_ft2']
const LIMITEDMETRICS = ['latest_energy_star_score', 'latest_total_ghg_emissions_metric_tons_co2e', 'latest_site_eui_kbtu_ft2']
const RANKINGMETRIC = 'latest_energy_star_score'
const RANKINGMETRICTIEBREAK ='latest_site_eui_kbtu_ft2'
const BLK = /(.+)\//
const LOT = /[\/\.](.+)/

/* glogal reference objects */
/* colorSwatches should be shared between map.js & dashboard.js */
var colorSwatches = {
      energy_star_score: ['#EF839E','#ECD68C','#80D9AF','#4FAD8E'],
      total_ghg_emissions_intensity_kgco2e_ft2: ['#4FAD8E', '#80D9AF', '#ECD68C', '#EF839E'],
      site_eui_kbtu_ft2: ['#4FAD8E','#80D9AF', '#ECD68C', '#EF839E', '#ed5b5b'], //has to be 5 colors for the gradient to look right
      highlight: '#0d32d4'
    };

var color = {
  energy_star_score: d3.scale.threshold().range(colorSwatches.energy_star_score),
  total_ghg_emissions_intensity_kgco2e_ft2: d3.scale.threshold().range(colorSwatches.total_ghg_emissions_intensity_kgco2e_ft2),
  site_eui_kbtu_ft2: d3.scale.linear().range(colorSwatches.site_eui_kbtu_ft2),
  ranking: d3.scale.threshold().range(colorSwatches.total_ghg_emissions_intensity_kgco2e_ft2)
}

/* use soda-js to query */
// ref: https://github.com/socrata/soda-js
let consumer = new soda.Consumer('data.sfgov.org')

let groups = {
  Office:{
    names: [
      '<25k',
      '25-50k',
      '50-100k',
      '100-300k',
      '>300k'
    ],
    floorArea: [
      25000,
      50000,
      100000,
      300000
    ]
  },
  Hotel: {
    names: [
      '<25k',
      '25-50k',
      '50-100k',
      '100-250k',
      '>250k'
    ],
    floorArea: [
      25000,
      50000,
      100000,
      250000
    ]
  },
  'Retail Store': {
    names: [
      '<20k',
      '>20k'
    ],
    floorArea: [
      20000
    ]
  }
}
for (let category in groups){
  /* d3.scale to get "similar" sized buildings */
  groups[category].scale = d3.scale.threshold()
        .domain(groups[category].floorArea)
        .range(groups[category].names);
}

/* example queries */
// console.log( formQueryString(testquery) )
// propertyQuery( 1, specificParcel, null, handleSingleBuildingResponse )
// propertyQuery( null, null, formQueryString(testquery), handlePropertyTypeResponse )
// propertyQuery( null, {property_type_self_selected:'Office'}, null, handlePropertyTypeResponse )


/* page elements */
var estarHistogramElement = d3.select('#energy-star-score-histogram')
var estarWidth = 500 //parseInt(estarHistogramElement.style('width'))
var estarHistogram = histogramChart()
  .width(estarWidth)
  .height(200)
  .range([0,110])
  .tickFormat(d3.format(',d'))

var ghgHistogramElement = d3.select('#ghg-emissions-histogram')
var ghgWidth = 500 //parseInt(ghgHistogramElement.style('width'))
var ghgHistogram = histogramChart()
  .width(ghgWidth)
  .height(200)
  .range([0,1650])
  .tickFormat(d3.format(',d'))

var euiChartElement = d3.select('#eui-quartileschart')

// let ringChartElement = d3.select('#energy-star-score-radial')
// let rankRingChart = ringChart()
//   .width(100)
//   .height(100)




/* query machine go! */
let singleBuildingData
let categoryData
let floorAreaRange


var urlVars = getUrlVars();
if (urlVars.apn == undefined){
    console.error("Not a valid APN")
    //TODO: alert the user
} else {
  // APN numbers look like 3721/014 and come from SF Open Data --
  // -- see example: https://data.sfgov.org/Energy-and-Environment/Existing-Commercial-Buildings-Energy-Performance-O/j2j3-acqj
  console.log("Trying APN: " + urlVars['apn']);
  $('#view-welcome').addClass('hidden')
  $('#view-load').removeClass('hidden')
  propertyQuery( 1, {parcel_s: urlVars['apn']}, null, handleSingleBuildingResponse )
}

// Get URL parameters
// see also: http://snipplr.com/view/19838
// Usage: `map = getUrlVars()` while at example.html?foo=asdf&bar=jkls
// sets map['foo']='asdf' and map['bar']='jkls'
function getUrlVars() {
  var vars = {};
  window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi,
    function(m,key,value) {
      vars[key] = value;
    });
  return vars;
}



/**
* whereArray - form the 'where array' that goes into formQueryString
* @param {string} propertyType - property_type_self_selected
* @param {array} range - [min,max] of floor_area
* @return {array} the 'where array'
*/
function whereArray(propertyType, range){
  if (range[0] == undefined) {range[0] = 10000}
  let res = [
    "property_type_self_selected='" + propertyType + "'",
    'floor_area > ' + range[0]
  ]
  if (range[1]) {
    res.push('floor_area < ' + range[1])
  }
  return res
}

/**
* formQueryString - form a SOQL query string
* for multi-condition WHERE, otherwise use soda-js Consumer
* see https://dev.socrata.com/docs/queries/query.html
* @param {object} params - query params, limited in implementation
* @return {string} the query string
*/
function formQueryString(params){
  let query = 'SELECT '

  if (params.columns){
    // params.columns is a string of comma separated column headings
    query += params.columns + ' '
  } else {
    query += '* '
  }

  if (params.where){
    // params.where is an array of conditions written out as strings
    query += 'WHERE ' + params.where[0] + ' '
    let i = 1, len = params.where.length
    if (len > 1){
      for (; i<len; i++) {
        query += 'AND ' + params.where[i] + ' '
      }
    }
  }

  if (params.limit){
    //params.limit is an integer
    query += 'LIMIT ' + params.limit
  }

  return query
}

/**
* propertyQuery - query sfdata for a parcel or parcels
* @param {number} limit - how many entries to return
* @param {object} whereparams - query params, generally of the form {parcel_s: "####/###"} or {property_type_self_selected: "Office"}
* @param {string} soqlQuery - complete SOQL query string.  it seems this will override parameters in 'limit' and 'whereparams' if not null
* @param {function} handler - callback handler function for returned json
* @return some sort of promise
*/
function propertyQuery(limit, whereparams, soqlQuery, handler) {
  consumer.query()
    .withDataset(DATASOURCE)
    .limit(limit)
    .where(whereparams)
    .soql(soqlQuery)
    .getRows()
      // this might be starting down the road to callback hell
      .on('success', handler)
      .on('error', function(error) { console.error(error); });
}

/**
* handleSingleBuildingResponse - do something with the returned data, expects only one row
* @param {array} rows - returned from consumer.query.getRows, expects rows.length === 0
*/
function handleSingleBuildingResponse(rows) {
  if (typeof rows[0] == 'undefined') {
    return $('#view-load').html('The record for the chosen building was not found')
  }
  singleBuildingData = parseSingleRecord(rows[0]) //save data in global var

  let type = singleBuildingData.property_type_self_selected

  /* check to see if the returned building is one of our supported building types */
  if (Object.keys(groups).indexOf(type) == -1) {
    console.error("not a supported building type");
    $('#view-load').html('The chosen building type is not supported by this dashboard interface')
  } else {
    let minMax = groups[type].scale.invertExtent(groups[type].scale(+singleBuildingData.floor_area))
    floorAreaRange = minMax
    propertyQuery( null, null, formQueryString({where: whereArray( type, minMax )}), handlePropertyTypeResponse )
  }
}

/**
* handlePropertyTypeResponse - do something with the returned data
* @param {array} rows - returned from consumer.query.getRows
*/
function handlePropertyTypeResponse(rows) {
  //TODO: parseSingleRecord finds the "latest" value for each metric, so the comparisons between buildings are not necessarially within the same year.  perhaps parseSingleRecord should accept a param for year, passing to "latest" which finds that particular year instead of the "latest" metric. OR the propertyQuery call inside handleSingleBuildingResponse should take a param for year that only requests records which are not null for the individual building's "latest" metric year
  categoryData = rows.map(parseSingleRecord)    // save data in global var
  categoryData = cleanData(categoryData)        // clean data according to SFENV's criteria
  categoryData = apiDataToArray( categoryData ) // filter out unwanted data

  let estarVals = objArrayToSortedNumArray(categoryData, 'latest_energy_star_score')
  estarVals = estarVals.filter(function (d) { return d > 0 })

  let ghgVals = objArrayToSortedNumArray(categoryData, 'latest_total_ghg_emissions_metric_tons_co2e')
  ghgVals = ghgVals.filter(function (d) { return d > 0 })

  let euiVals = objArrayToSortedNumArray(categoryData,'latest_site_eui_kbtu_ft2')
  euiVals = euiVals.filter(function (d) { return d > 1 && d < 1000 })

  singleBuildingData.localRank = rankBuildings(singleBuildingData.ID, categoryData, RANKINGMETRIC, RANKINGMETRICTIEBREAK)

  /* set color domains */
  var estarQuartiles = arrayQuartiles(estarVals)
  color.energy_star_score.domain(estarQuartiles)
  color.total_ghg_emissions_intensity_kgco2e_ft2.domain(arrayQuartiles(ghgVals))
  color.site_eui_kbtu_ft2.domain(arrayQuartiles(euiVals))
  color.ranking.domain([ 0.25*singleBuildingData.localRank[1], 0.5*singleBuildingData.localRank[1], 0.75*singleBuildingData.localRank[1] ])

  /** Calculate z-score (Wasted a lot of time trying to get JS libs to work here, seems to be a lot easer to
  *                      explicitly calculat it--admittedly, it could be me as I'm not super JavaScript savvy)
  *       Libraries explored:
  *         - jStat: https://github.com/jstat/jstat
  *         - simple-statistics: https://github.com/simple-statistics/simple-statistics
  */
  // categoryData.zscoreVal = jstat.zscore(singleBuildingData.latest_energy_star_score, estarVals)
  // categoryData.zscoreVal = (singleBuildingData.latest_energy_star_score - d3.mean(estarVals)) / d3.deviation(estarVals)

  /* draw histogram for energy star */
  estarHistogram
    .colorScale(color.energy_star_score)
    .bins(20)
    .xAxisLabel('Energy Star Score')
    .yAxisLabel('Buildings')
  estarHistogramElement.datum(estarVals).call(estarHistogram)

  estarHistogramElement.call(addHighlightLine,singleBuildingData.latest_energy_star_score, estarHistogram,singleBuildingData.building_name)

  /* draw histogram for ghg */
  ghgHistogram
    .range([0,d3.max(ghgVals)])
    .colorScale(color.total_ghg_emissions_intensity_kgco2e_ft2)
    .bins(100)
    .xAxisLabel('GHG Emissions (Metric Tons CO2)')
    .yAxisLabel('Buildings')
    // .tickFormat(d3.format("d"))
  ghgHistogramElement.datum(ghgVals).call(ghgHistogram)
  ghgHistogramElement.call(addHighlightLine,singleBuildingData.latest_total_ghg_emissions_metric_tons_co2e,ghgHistogram,singleBuildingData.building_name)

  /* draw stacked bar for energy use intensity */
  // var euiWidth = parseInt(euiChartElement.style('width'))
  var euiWidth = 650
  var euiChart = quartilesChart()
    .width(euiWidth)
    .height(150)
    .colorScale(color.site_eui_kbtu_ft2)
    .margin({top: 20, right: 80, bottom: 20, left: 50})
  euiChartElement.datum(euiVals).call(euiChart)
  euiChartElement.call(addHighlightLine, singleBuildingData.latest_site_eui_kbtu_ft2, euiChart, singleBuildingData.building_name)

  populateInfoBoxes(singleBuildingData, categoryData, floorAreaRange)

  $('#view-load').addClass('hidden')
  $('#view-content').removeClass('hidden')
}

/**
* parseSingleRecord - parse the returned property record object
* @param {object} record - the record object returned from SODA
* @return {object} the record from @param with our "latest_" properties added
*/
function parseSingleRecord(record){
  if (record.parcel_s === undefined) {return null}
  if (! record.hasOwnProperty('property_type_self_selected') ) { record.property_type_self_selected = 'N/A'}
  record.parcel1 = BLK.exec(record.parcel_s)[1]
  record.parcel2 = LOT.exec(record.parcel_s)[1]
  record.blklot = '' + record.parcel1 + record.parcel2
  record.ID = '' + record.blklot
  METRICS.forEach(function (metric) {
    record = latest(metric, record)
  })
  return record
}

/**
* latest - loop through a single parcel to find the latest data
* @param {string} metric - the parcel metric being recorded
* @param {object} entry - the parcel record object
* @return {object} - the entry param with new "latest_" properties
*/
function latest (metric, entry) {
  var thisYear = new Date().getFullYear()
  var years = []
  for (let i = 2011; i < thisYear; i++) {
    years.push(i)
  }
  if (metric === 'benchmark') years.unshift(2010)
  var yearTest = years.map(function(d){
    if (metric === 'benchmark') return 'benchmark_' + d + '_status'
    else return '_' + d + '_' + metric
  })
  yearTest.forEach(function(year,i){
    if (entry[year] != null){
      entry['latest_'+metric] = entry[year]
      entry['latest_'+metric+'_year'] = years[i]
    }
    else {
      entry['latest_'+metric] = entry['latest_'+metric] || 'N/A'
      entry['latest_'+metric+'_year'] = entry['latest_'+metric+'_year'] || 'N/A'
    }
    if ( !isNaN(+entry['latest_'+metric]) ) {
      entry['latest_'+metric] = roundToTenth(+entry['latest_'+metric])
    }
  })
  if (metric !== 'benchmark') {
    entry['pct_change_one_year_'+metric] = calcPctChange(entry, metric, 1)
    entry['pct_change_two_year_'+metric] = calcPctChange(entry, metric, 2)
  }
  if (metric === 'benchmark') {
    var prevYear = 'benchmark_' + (entry.latest_benchmark_year - 1) + '_status'
    entry['prev_year_benchmark'] = entry[prevYear]
  }
  return entry
}

function calcPctChange(entry, metric, yearsBack){
  let prev = getPrevYearMetric(entry, metric, yearsBack)
  let pctChange = (+entry['latest_'+metric] - prev)/prev
  return pctChange * 100
}
function getPrevYearMetric(entry, metric, yearsBack){
  let targetYear = entry['latest_'+metric+'_year'] - yearsBack
  let key = (metric === 'benchmark') ? `benchmark_${targetYear}_status` : `_${targetYear}_${metric}`
  return +entry[key]
}

/**
* apiDataToArray - transform record array to get a simpler, standardized array of k-v pairs
* @param {array} data - the input array of data records
* @return {array} an array of objects only LIMITEDMETRICS keys
*/
function apiDataToArray (data) {
  let arr = data.map((parcel)=>{
    // if ( typeof parcel != 'object' || parcel === 'null' ) continue
    let res = {id: parcel.ID}
    LIMITEDMETRICS.forEach(metric=>{
        res[metric] = (typeof parseInt(parcel[metric]) === 'number' && !isNaN(parcel[metric])) ? parseInt(parcel[metric]) : -1
    })
    return res
  })
  return arr
}

/**
* populateInfoBoxes - brute force put returned data into infoboxes on the page
* @param {object} singleBuildingData - data for a single building
* @param {object} categoryData - data for the single building's category
* @param {object} floorAreaRange - floor area range for this category
* @return null
*/
function populateInfoBoxes (singleBuildingData,categoryData,floorAreaRange) {
  d3.select('#building-energy-star-score').text(singleBuildingData.latest_energy_star_score)
  d3.selectAll('.building-energy-star-score-year').text(singleBuildingData.latest_energy_star_score_year)
  d3.select('#building-eui').text(singleBuildingData.latest_site_eui_kbtu_ft2)
  d3.selectAll('.building-ghg-emissions').text(singleBuildingData.latest_total_ghg_emissions_metric_tons_co2e)
  d3.selectAll('.building-ghg-emissions-year').text(singleBuildingData.latest_total_ghg_emissions_metric_tons_co2e_year)

  if ( !singleBuildingData.latest_energy_star_score ) {
    d3.select('#estar-text').html(`The national <span class="building-type-lower">hotel</span> median energy star score is 50.`)
  }

  d3.selectAll('.building-type-lower').text(singleBuildingData.property_type_self_selected.toLowerCase())
  d3.selectAll('.building-type-upper').text(singleBuildingData.property_type_self_selected.toUpperCase())

  d3.select('#building-floor-area').text(numberWithCommas(singleBuildingData.floor_area))
  d3.selectAll('.building-name').text(singleBuildingData.building_name)
  d3.select('#building-street-address').text(singleBuildingData.building_address)
  d3.select('#building-city-address').text(
    singleBuildingData.full_address_city + ' ' +
    singleBuildingData.full_address_state + ', ' +
    singleBuildingData.full_address_zip + ' '
  )
  d3.selectAll('.building-type-sq-ft').text(numberWithCommas(floorAreaRange[0]) + '-' + numberWithCommas(floorAreaRange[1]))


  if (singleBuildingData.localRank) {
    d3.selectAll('.building-ranking-text').text(singleBuildingData.localRank[0])
    d3.selectAll('.total-building-type').text(singleBuildingData.localRank[1])
    // rankRingChart.colorScale(color.ranking)
    // ringChartElement.datum([singleBuildingData.localRank]).call(rankRingChart)
  } else {
    // the building is not rankable: did not report an estar score OR the % change in eui either increased by more than 100 or decreased by more than 80 over the previous 2 years
    d3.select('.local-ranking-container').classed('hidden', true)
    d3.selectAll('.estar-ranking-text').text(`${singleBuildingData.building_name} could not be ranked against other ${singleBuildingData.property_type_self_selected.toLowerCase()}s using the latest benchmark data.`)
  }

  var complianceStatusIndicator = `${singleBuildingData.latest_benchmark_year}: ${complianceStatusString(singleBuildingData.latest_benchmark)} <br>
  ${singleBuildingData.latest_benchmark_year - 1}: ${complianceStatusString(singleBuildingData.prev_year_benchmark)}`

  function complianceStatusString(status){
    var indicator = (status == "Complied") ?
      ' <i class="fa fa-check" aria-hidden="true"></i>'
      :
      ' <i class="fa fa-times attn" aria-hidden="true"></i>'
    return `${indicator} ${status}`
  }

  d3.select('#compliance-status').html(complianceStatusIndicator)

  d3.select('.ranking').text('LOCAL RANKING ' + singleBuildingData.latest_benchmark_year)
}

/**
* rankBuildings - ranking algorithim, dumb sort for now
* @param {string} id - building "ID" number
* @param {array} bldgArray - processed/simplified building data
* @param {string} prop - the property to rank by
* @param {string} prop2 - the property to rank by if a[prop] === b[prop]
* @return {array} [rank, count]
*/
function rankBuildings (id, bldgArray, prop, prop2) {
  let sorted = bldgArray.sort(function(a,b){
    if( +a[prop] === +b[prop] ) {
      return +a[prop2] - +b[prop2]
    }
    return +b[prop] - +a[prop]
  })

  sorted = sorted.filter(el=>{return el[prop] > 0})

  let rank = sorted.findIndex(function(el){return el.id === id})
  if (rank === -1) return false //indicates building not in ranking array
  rank += 1
  let count = sorted.length

  return [rank, count]
}

/**
* cleanData - remove property listings that don't meet criteria provided by SF Dept of Env
* @param {array} inputData - data from socrata
* @return {array} - % change eui has not increased by more than 100 nor decreased by 80 over the previous 2 years
*/
function cleanData (inputData) {
  var filtered = inputData.filter(function(el){
    var cond1 = (el.pct_change_one_year_site_eui_kbtu_ft2 <= 100) && (el.pct_change_one_year_site_eui_kbtu_ft2 >= -80)
    var cond2 = (el.pct_change_two_year_site_eui_kbtu_ft2 <= 100) && (el.pct_change_two_year_site_eui_kbtu_ft2 >= -80)
    var cond3 = el[RANKINGMETRIC] !== undefined
    return (cond1 && cond2 & cond3)
  })
  return filtered
}

/****** helper functions *******/
function onlyNumbers (val) {
  return (typeof parseInt(val) === 'number' && !isNaN(val)) ? parseInt(val) : -1
}

function objArrayToSortedNumArray (objArray,prop) {
  return objArray.map(function (el){ return el[prop] }).sort(function (a,b) { return a - b })
}

function roundToTenth (num){
  return Math.round(10*num)/10
}

function numberWithCommas(x) {
    if (typeof x === 'undefined') return "and above"
    var parts = x.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
}

/**
* addHighlightLine - add a highlight bar to a histogram chart
* @param {object} selection - d3 selection of the dom element for the histogram chart
* @param {integer} data - the value to highlight
* @param {object} chart - the histogram chart object
* @param {string} label - the label for the highlighting bar
*/
function addHighlightLine (selection, data, chart, label) {
  label = (label != undefined) ? `${label.toUpperCase()} - ${data}` : `${data}`
  if( isNaN(data) ) data = -100
  var x = chart.xScale(),
      y = chart.yScale(),
      margin = chart.margin(),
      width = chart.width(),
      height = chart.height()
  var svg = selection.select('svg')
  var hl = svg.select("g").selectAll('.highlight').data([data])

  var lineFunction = d3.svg.line()
        .x(function(d) { return d.x; })
        .y(function(d) { return d.y; })
        .interpolate("linear")

  var hlline = [
    {x:x(data), y:0},
    {x:x(data), y: height - margin.bottom - margin.top}
  ]

  var moreThanHalf = ( x(data) < chart.width()/2 ) ? false : true
  var textPos = moreThanHalf ? x(data)-5 : x(data)+5
  var textAnchor = moreThanHalf ? 'end' : 'start'

  hl.enter().append("path")
        .attr('class', 'highlight')
        .attr("d", lineFunction(hlline))
        .attr("stroke", colorSwatches.highlight)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", "5,3")
        .attr("fill", "none");
  hl.enter().append("text")
        .attr('x', textPos)
        .attr('y', 16)
        .attr('text-anchor', textAnchor)
        .attr('alignment-baseline', 'top')
        .attr("fill", colorSwatches.highlight)
        .text(label)
  hl.exit().remove()
}


function arrayQuartiles (sortedArr) {
  return [
    d3.quantile(sortedArr,0.25),
    d3.quantile(sortedArr,0.5),
    d3.quantile(sortedArr,0.75)
  ]
}

function setSidePanelHeight(){
  var contentHeight = $('#view-content').height()
  $('.panel-body.side.flex-grow').height(contentHeight - 10);
}
setTimeout(setSidePanelHeight, 1000)
