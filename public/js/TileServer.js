

////////////////////////////////////////////////////////////////////////////////////////////////////////
// math helpers
// TODO perhaps put this somewhere cleaner later
////////////////////////////////////////////////////////////////////////////////////////////////////////

// https://en.wikipedia.org/wiki/Gudermannian_function
// http://aperturetiles.com/docs/development/api/jsdocs/binning_WebMercatorTilePyramid.js.html
// https://stackoverflow.com/questions/1166059/how-can-i-get-latitude-longitude-from-x-y-on-a-mercator-map-jpeg

var EPSG_900913_SCALE_FACTOR = 20037508.342789244;
var EPSG_900913_LATITUDE = 85.05112878;
var DEGREES_TO_RADIANS = Math.PI / 180.0; // Factor for changing degrees to radians
var RADIANS_TO_DEGREES = 180.0 / Math.PI; // Factor for changing radians to degrees

let pi2deg = function(v) { return v*RADIANS_TO_DEGREES; }
let deg2pi = function(v) { return v*DEGREES_TO_RADIANS; }

function sinh( arg ) {
  return (Math.exp(arg) - Math.exp(-arg)) / 2.0;
}

function gudermannian( y ) {
  // converts a y value from -PI(bottom) to PI(top) into the mercator projection latitude
  return Math.atan(sinh(y)) * RADIANS_TO_DEGREES;
}

function gudermannianInv( latitude ) {
  // converts a latitude value from -EPSG_900913_LATITUDE to EPSG_900913_LATITUDE into a y value from -PI(bottom) to PI(top)
  let sign = ( latitude !== 0 ) ? latitude / Math.abs(latitude) : 0;
  let sin = Math.sin(latitude * DEGREES_TO_RADIANS * sign);
  return sign * (Math.log((1.0 + sin) / (1.0 - sin)) / 2.0);
}

function gudermannianToLinear(value) {
  return (gudermannianInv( value ) / Math.PI) * EPSG_900913_LATITUDE;
}

function gudermannian_radians(arg) {
  return Math.atan(sinh(arg*2));
}


////////////////////////////////////////////////////////////////////////////////////////////////////////
///
/// TileServer is intended to be a prototypical elevation tile provider - by default for Cesium tiles
/// TODO change this to an aframe-system
///
////////////////////////////////////////////////////////////////////////////////////////////////////////

class TileServer  {
 
  constructor(terrainProvider,imageProvider,guder) {
    this.terrainProvider = terrainProvider;
    this.imageProvider = imageProvider;
    this.guder = guder ? 1 : 0;
  }

  ready(callback) {
    Cesium.when(this.terrainProvider.readyPromise).then( unused => {
      ImageServer.instance().ready(callback);
    });
  }

  getGround(data,callback) {
    // TODO replace with custom elevation derivation - see findClosestElevation() - but it needs to interpolate still
    let scope = this;
    let poi = Cesium.Cartographic.fromDegrees(data.lon,data.lat);
    Cesium.sampleTerrain(scope.terrainProvider,data.lod,[poi]).then(function(groundResults) {
      callback(groundResults[0].height);
    });
  }

  findClosestElevation(scheme) {
    // TODO may want to actually interpolate rather than merely taking the closest elevation...
    let tile = scheme.tile;
    let distance = Number.MAX_SAFE_INTEGER;
    let best = 0;
    for (let i=0; i<tile._uValues.length; i++) {
      let x = (scheme.x-scheme.xtile)*32767 - tile._uValues[i]; // compiler will optimize
      let y = (scheme.y-scheme.ytile)*32767 - tile._vValues[i];
      if(x*x+y*y < distance) {
        distance = x*x+y*y;
        best = (((tile._heightValues[i]*(tile._maximumHeight-tile._minimumHeight))/32767.0)+tile._minimumHeight);
      }
    }
    return best;
  }

  getRadius() {
    return 63727982.0;
  }

  getCircumference() {
    return 400414720.159; // 2*Math.PI*this.getRadius();
  }

  elevation2lod(d) {
    let c = this.getCircumference();
    // truncate reasonable estimations for lod
    if(d < 1) d = 1;
    if(d > c/2) d = c/2;
    // even a small camera fov of 45' would show the entire circumference of the earth at a distance of circumference/2 if the earth was flattened
    // the visible area is basically distance * 2 ... so  ... number of tiles = circumference / (distance*2)
    // visible coverage is 2^(lod+1) = number of tiles  or .... 2^(lod+1) = c / (d*2) ... or ... 
    // also see https://gis.stackexchange.com/questions/12991/how-to-calculate-distance-to-ground-of-all-18-osm-zoom-levels/142555#142555
    let lod = Math.floor(Math.log2(c/(d*2)));
    // truncate
    if(lod < 0) lod = 0;
    if(lod > 19) lod = 19;
    return lod;
  }

  ll2yx(data) {

    // This commented out approach is the more correct way get below details from an arbitrary cesium terrain provider - but requires waiting for ready event
    // this.terrainProvider.tilingScheme.getNumberOfXTilesAtLevel(lod) * (180+lon) / 360;
    // this.terrainProvider.tilingScheme.getNumberOfYTilesAtLevel(lod) * ( 90-lat) / 180;
    // let poi = Cesium.Cartographic.fromDegrees(lon,lat);
    // let xy = this.terrainProvider.tilingScheme.positionToTileXY(poi,lod);
    // scheme.rect = this.terrainProvider.tilingScheme.tileXYToRectangle(xy.x,xy.y,lod);

    let scheme = {};

    let lat = scheme.lat = data.lat;
    let lon = scheme.lon = data.lon;
    let lod = scheme.lod = data.lod;
    let radius = scheme.radius = data.radius;

    // get number of tiles wide and tall - hardcoded to cesium terrain tiles TMS format
    scheme.w = Math.pow(2,lod+1);
    scheme.h = Math.pow(2,lod);

    // get tile index with fractional exact position
    scheme.x = (180+lon) * scheme.w / 360;
    scheme.y = ( 90-lat) * scheme.h / 180;

    // get tile index (remove fraction)
    scheme.xtile = Math.floor(scheme.x);
    scheme.ytile = Math.floor(scheme.y);

    // calculate uuid for tile
    scheme.uuid = "tile-"+scheme.xtile+"-"+scheme.ytile+"-"+lod;

    // position in radians
    scheme.lonrad = scheme.lon * Math.PI / 180;
    scheme.latrad = scheme.lat * Math.PI / 180;

    // extents in radians
    let a = ( (scheme.xtile + 0) * 360 / scheme.w - 180   ) * Math.PI / 180;
    let b = ( (scheme.xtile + 1) * 360 / scheme.w - 180   ) * Math.PI / 180;
    let c = ( - (scheme.ytile+0) * 180 / scheme.h + 90    ) * Math.PI / 180;
    let d = ( - (scheme.ytile+1) * 180 / scheme.h + 90    ) * Math.PI / 180;
    scheme.rect = { west:a, south:d, east:b, north:c };

    // degrees of coverage in radiams
    scheme.degrees_lonrad = scheme.rect.east-scheme.rect.west;
    scheme.degrees_latrad = scheme.rect.north-scheme.rect.south;

    // degrees of coverage
    scheme.degrees_lon = 360 / scheme.w; 
    scheme.degrees_lat = 180 / scheme.h;

    // TODO make this a parameter
    scheme.building_url = "https://s3.amazonaws.com/cesium-dev/Mozilla/SanFranciscoGltf15Gz/"+scheme.lod+"/"+scheme.xtile+"/"+scheme.ytile+".gltf";

    // convenience values
    scheme.width_world = this.getCircumference();
    scheme.width_tile_flat = scheme.width_world / scheme.w;
    scheme.width_tile_lat = scheme.width_tile_flat * Math.cos(data.lat * Math.PI / 180);

    return scheme;
  }

  ll2v(latrad,lonrad,r=1) {
    // given a latitude and longitude in radians return a vector
    let phi = Math.PI/2-latrad;
    let theta = Math.PI/2+lonrad;
    let x = -r*Math.sin(phi)*Math.cos(theta);
    let z = r*Math.sin(phi)*Math.sin(theta);
    let y = r*Math.cos(phi);
    return new THREE.Vector3(x,y,z);
  }

  toGeometryEmulatingCesium(scene) {

    // some test code to look at how cesium was building the Gudermannian 

    // prepare to build a portion of the hull of the surface of the planet - this will be a curved mesh of x by y resolution (see below)
    let geometry = new THREE.Geometry();

    // scale is arbitrary
    let scale = 256;

    // stride across the hull at this x resolution
    let xs = 16;

    // stride across the hull at this y resolution
    let ys = 16;

    // here is the code from https://github.com/AnalyticalGraphicsInc/cesium/blob/master/Source/Scene/ImageryLayer.js#L1026
    // just wanted to see what the fractional values were over some extent

    var sinLatitude = Math.sin(scheme.rect.south);
    var southMercatorY = 0.5 * Math.log((1 + sinLatitude) / (1 - sinLatitude));

    sinLatitude = Math.sin(scheme.rect.north);
    var northMercatorY = 0.5 * Math.log((1 + sinLatitude) / (1 - sinLatitude));
    var oneOverMercatorHeight = 1.0 / (northMercatorY - southMercatorY);

    // build vertices (for a given x,y point on the hull calculate the longitude and latitude of that point)
    for(let y = 0; y <= scale; y+=ys) {
     // for(let x = 0; x <= scale; x+=xs) {
        let fraction = y / 255;
        let latitude = (scheme.rect.south-scheme.rect.north) * fraction;
         sinLatitude = Math.sin(latitude);
        let mercatorY = 0.5 * Math.log((1.0 + sinLatitude) / (1.0 - sinLatitude));
        let mercatorFraction = (mercatorY - southMercatorY) * oneOverMercatorHeight;
        console.log("lat = "+latitude+" sinlat="+sinLatitude+" mercfract=" + mercatorFraction);
      //}
    }

  }

  toGeometryIdealized(scheme) {

    // prepare to build a portion of the hull of the surface of the planet - this will be a curved mesh of x by y resolution (see below)
    let geometry = new THREE.Geometry();

    // scale is arbitrary
    let scale = 256;

    // stride across the hull at this x resolution
    let xs = 16;

    // stride across the hull at this y resolution
    let ys = 16;

    // build vertices (for a given x,y point on the hull calculate the longitude and latitude of that point)
    for(let y = 0; y <= scale; y+=ys) {
      for(let x = 0; x <= scale; x+=xs) {

        // x position for vertex within hull
        let lonrad = scheme.degrees_lonrad * x / scale + scheme.rect.west;

        // y position for vertex within hull
        let latrad = scheme.rect.north - scheme.degrees_latrad * y / scale;

        if(this.guder) {
          // Here is my attempt to take the idealized surface and distort the vertices to produce the right visual appearance for image draping
          let arg = latrad*2;
          let e = (Math.exp(arg) - Math.exp(-arg)) / 2.0;
          latrad = Math.atan(e);  // http://mathworld.wolfram.com/InverseTangent.html
        }

        let radius = scheme.radius;
        let v = this.ll2v(latrad,lonrad,radius);
      //  console.log(v);
        geometry.vertices.push(v);
      }
    }
    // connect the dots
    for(let y = 0, v =0; y < scale; y+=ys) {
      for(let x = 0; x < scale; x+=xs) {
        geometry.faces.push(new THREE.Face3(v+1,v,v+scale/xs+1));
        geometry.faces.push(new THREE.Face3(v+1,v+scale/xs+1,v+scale/xs+1+1));
        v++;
      }
      v++;
    }
    // uvs
    geometry.faceVertexUvs[0] = [];
    for(let y = 0, v = 0; y < scale; y+=ys) {
      for(let x = 0; x < scale; x+=xs) {
        let vxa = x/scale;
        let vya = y/scale;
        let vxb = (x+xs)/scale;
        let vyb = (y+ys)/scale;
        vya = 1-vya;
        vyb = 1-vyb;
        geometry.faceVertexUvs[0].push([ new THREE.Vector2(vxb,vya), new THREE.Vector2(vxa,vya), new THREE.Vector2(vxa,vyb) ]);
        geometry.faceVertexUvs[0].push([ new THREE.Vector2(vxb,vya), new THREE.Vector2(vxa,vyb), new THREE.Vector2(vxb,vyb) ]);
      }
    }
    geometry.uvsNeedUpdate = true;
    // face normals
    geometry.computeFaceNormals();
    return geometry;
  }

  toGeometry(scheme) {
    let tile = scheme.tile;
    let geometry = new THREE.Geometry();
    let earth_radius = this.getRadius();
    // build vertices on the surface of a globe given a linear latitude and longitude series of stepped values -> makes evenly distributed spherically points
    for (let i=0; i<tile._uValues.length; i++) {
      let lonrad = tile._uValues[i]/32767*scheme.degrees_lonrad + scheme.rect.west;
      let latrad = tile._vValues[i]/32767*scheme.degrees_latrad + scheme.rect.south;
      let elevation = (((tile._heightValues[i]*(tile._maximumHeight-tile._minimumHeight))/32767.0)+tile._minimumHeight);

      // TODO fix mercator distortion in vertex space for now - unsure if we want to leave this here
      if(this.guder) { latrad = gudermannian_radians(latrad); }

      let v = this.ll2v(latrad,lonrad,(earth_radius+elevation)*scheme.radius/earth_radius);
      geometry.vertices.push(v);
    }
    // vertices to faces
    for (let i=0; i<tile._indices.length-1; i=i+3) {
      geometry.faces.push(new THREE.Face3(tile._indices[i], tile._indices[i+1], tile._indices[i+2]));
    }
    // face vertices to linear distribution uv map
    // TODO this definitely must consider gudermannian mercator projection
    let faces = geometry.faces;
    geometry.faceVertexUvs[0] = [];
    for (let i = 0; i < faces.length ; i++) {
      let vxa = tile._uValues[faces[i].a]/32767;
      let vya = tile._vValues[faces[i].a]/32767;
      let vxb = tile._uValues[faces[i].b]/32767;
      let vyb = tile._vValues[faces[i].b]/32767;
      let vxc = tile._uValues[faces[i].c]/32767;
      let vyc = tile._vValues[faces[i].c]/32767;
      geometry.faceVertexUvs[0].push([ new THREE.Vector2(vxa,vya), new THREE.Vector2(vxb,vyb), new THREE.Vector2(vxc,vyc) ]);
    }
    geometry.uvsNeedUpdate = true;
    // face normals
    geometry.computeFaceNormals();
    return geometry;
  }

  produceTile(data,callback) {
    let scheme = this.ll2yx(data);
    this.imageProvider.provideImage(scheme, material => {
      scheme.material = material;
      Cesium.when(this.terrainProvider.requestTileGeometry(scheme.xtile,scheme.ytile,scheme.lod),tile => {
        scheme.tile = tile;
        scheme.geometry = this.toGeometry(scheme); // this.toGeometryIdealized(scheme);
        scheme.mesh = new THREE.Mesh(scheme.geometry,scheme.material);
        callback(scheme);
      });
    });
  }
}

///
/// Singelton convenience handles
/// TODO an AFrame System could do this https://aframe.io/docs/0.7.0/core/systems.html
///

TileServer.instance = function() {
  let guder = (new URLSearchParams(window.location.search)).get("guder");
  if(TileServer.tileServer) return TileServer.tileServer;
  let provider = new Cesium.CesiumTerrainProvider({
    requestVertexNormals : true, 
    url:"https://assets.agi.com/stk-terrain/v1/tilesets/world/tiles",
  });
  TileServer.tileServer = new TileServer(provider,ImageServer.instance(),guder ? 1 : 0);
  return TileServer.tileServer;
};
