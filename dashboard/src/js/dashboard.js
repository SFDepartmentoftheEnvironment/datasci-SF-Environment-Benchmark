"use strict"
import soda from 'soda-js'
import * as dataManipulation from './dataManipulation.js'
import * as apiCalls from './apiCalls.js'
import * as helpers from './helpers.js'
import quartilesChart from '../../../js/quartiles-chart.js'
import histogramChart from '../../../js/histogram-chart.js'


//TODO: CHANGE limit on returned properties in function propertyTypeQuery()



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
// console.log( apiCalls.formQueryString(testquery) )
// apiCalls.propertyQuery( consumer, 1, specificParcel, null, handleSingleBuildingResponse )
// apiCalls.propertyQuery( consumer, null, null, apiCalls.formQueryString(testquery), handlePropertyTypeResponse )
// apiCalls.propertyQuery( consumer, null, {property_type_self_selected:'Office'}, null, handlePropertyTypeResponse )


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


var urlVars = helpers.getUrlVars();
if (urlVars.apn == undefined){
    console.error("Not a valid APN")
    //TODO: alert the user
} else {
  // APN numbers look like 3721/014 and come from SF Open Data --
  // -- see example: https://data.sfgov.org/Energy-and-Environment/Existing-Commercial-Buildings-Energy-Performance-O/j2j3-acqj
  console.log("Trying APN: " + urlVars['apn']);
  $('#view-welcome').addClass('hidden')
  $('#view-load').removeClass('hidden')
  apiCalls.propertyQuery(consumer, 1, {parcel_s: urlVars['apn']}, null, handleSingleBuildingResponse )
}


/**
* handleSingleBuildingResponse - do something with the returned data, expects only one row
* @param {array} rows - returned from consumer.query.getRows, expects rows.length === 0
*/
function handleSingleBuildingResponse(rows) {
  if (typeof rows[0] == 'undefined') {
    return $('#view-load').html('The record for the chosen building was not found')
  }
  singleBuildingData = dataManipulation.parseSingleRecord(rows[0]) //save data in global var

  let type = singleBuildingData.property_type_self_selected

  /* check to see if the returned building is one of our supported building types */
  if (Object.keys(groups).indexOf(type) == -1) {
    console.error("not a supported building type");
    $('#view-load').html('The chosen building type is not supported by this dashboard interface')
  } else {
    let minMax = groups[type].scale.invertExtent(groups[type].scale(+singleBuildingData.floor_area))
    floorAreaRange = minMax
    apiCalls.propertyQuery(consumer, null, null, apiCalls.formQueryString({where: apiCalls.whereArray( type, minMax )}), handlePropertyTypeResponse )
  }
}

/**
* handlePropertyTypeResponse - do something with the returned data
* @param {array} rows - returned from consumer.query.getRows
*/
function handlePropertyTypeResponse(rows) {
  //TODO: dataManipulation.parseSingleRecord finds the "latest" value for each metric, so the comparisons between buildings are not necessarially within the same year.  perhaps dataManipulation.parseSingleRecord should accept a param for year, passing to "latest" which finds that particular year instead of the "latest" metric. OR the apiCalls.propertyQuery call inside handleSingleBuildingResponse should take a param for year that only requests records which are not null for the individual building's "latest" metric year
  categoryData = rows.map(dataManipulation.parseSingleRecord)    // save data in global var
  categoryData = dataManipulation.cleanData(categoryData)        // clean data according to SFENV's criteria
  categoryData = dataManipulation.apiDataToArray( categoryData ) // filter out unwanted data

  let estarVals = helpers.objArrayToSortedNumArray(categoryData, 'latest_energy_star_score')
  estarVals = estarVals.filter(function (d) { return d > 0 })

  let ghgVals = helpers.objArrayToSortedNumArray(categoryData, 'latest_total_ghg_emissions_metric_tons_co2e')
  ghgVals = ghgVals.filter(function (d) { return d > 0 })

  let euiVals = helpers.objArrayToSortedNumArray(categoryData,'latest_site_eui_kbtu_ft2')
  euiVals = euiVals.filter(function (d) { return d > 1 && d < 1000 })

  singleBuildingData.localRank = dataManipulation.rankBuildings(singleBuildingData.ID, categoryData)

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

  d3.select('#building-floor-area').text(helpers.numberWithCommas(singleBuildingData.floor_area))
  d3.selectAll('.building-name').text(singleBuildingData.building_name)
  d3.select('#building-street-address').text(singleBuildingData.building_address)
  d3.select('#building-city-address').text(
    singleBuildingData.full_address_city + ' ' +
    singleBuildingData.full_address_state + ', ' +
    singleBuildingData.full_address_zip + ' '
  )
  d3.selectAll('.building-type-sq-ft').text(helpers.numberWithCommas(floorAreaRange[0]) + '-' + helpers.numberWithCommas(floorAreaRange[1]))


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
