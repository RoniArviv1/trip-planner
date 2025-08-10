const mongoose = require('mongoose');

/**
 * Present totals consistently (back/forward compatible).
 * Accepts legacy fields (km/hours) and canonical fields (meters/seconds),
 * and returns both numeric and formatted values.
 */
function presentTotals(rd = {}) {
  // Legacy & canonical sources
  let meters  = Number(rd.totalDistanceMeters ?? rd.totalDistance ?? 0);
  let seconds = Number(rd.totalDurationSeconds ?? rd.totalDuration ?? 0);

  // Heuristics: if the legacy values look like km/hours -> convert to canonical
  if (Number.isFinite(meters) && meters && meters < 1000 && rd.totalDistance != null && rd.totalDistanceMeters == null) {
    meters = meters * 1000; // km -> m
  }
  if (Number.isFinite(seconds) && seconds && seconds < 1000 && rd.totalDuration != null && rd.totalDurationSeconds == null) {
    seconds = seconds * 3600; // hours -> seconds
  }

  const km    = Number.isFinite(meters)  ? meters / 1000 : 0;
  const hours = Number.isFinite(seconds) ? seconds / 3600 : 0;

  return {
    // Canonical
    totalDistanceMeters: Number.isFinite(meters)  ? meters  : 0,
    totalDurationSeconds: Number.isFinite(seconds) ? seconds : 0,
    // Derived numeric
    totalDistanceKm: Number.isFinite(km) ? km : 0,
    totalDurationHours: Number.isFinite(hours) ? hours : 0,
    // Formatted strings for UI
    formattedDistance: Number.isFinite(km)    ? `${km.toFixed(1)} km` : '—',
    formattedDuration: Number.isFinite(hours) ? `${Math.round(hours)} h` : '—',
  };
}

const routeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Route name is required'],
    trim: true,
    maxlength: [100, 'Route name cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  tripType: {
    type: String,
    enum: ['hiking', 'cycling'],
    required: [true, 'Trip type is required']
  },
  location: {
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true
    },
    region: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    coordinates: {
      lat: {
        type: Number,
        required: [true, 'Latitude is required']
      },
      lng: {
        type: Number,
        required: [true, 'Longitude is required']
      }
    }
  },
  routeData: {
    // GeoJSON LineString for the whole route (IMPORTANT for map rendering)
    geometry: {
      type: {
        type: String,
        enum: ['LineString'],
      },
      coordinates: {
        type: [[Number]], // [ [lng, lat], ... ]
      }
    },

    // Optional center for map fit (lat, lng)
    center: {
      type: [Number], // [lat, lng]
      default: undefined
    },

    // Flat points list (optional legacy)
    points: [{
      lat: Number,
      lng: Number,
      day: Number,   // Which day of the trip
      order: Number  // Order within the day
    }],

    // Daily route segments (optional)
    dailyRoutes: [{
      day: Number,
      distance: Number, // legacy: kilometers
      duration: Number, // legacy: hours
      elevation: {
        gain: Number,
        loss: Number
      },
      points: [{
        lat: Number,
        lng: Number,
        order: Number
      }]
    }],

    // Canonical totals (preferred)
    totalDistanceMeters: { type: Number },   // canonical
    totalDurationSeconds: { type: Number },  // canonical

    // Legacy totals (kept for backward compatibility; NOT required)
    totalDistance: { type: Number },         // legacy: kilometers
    totalDuration: { type: Number },         // legacy: hours

    totalElevation: {
      gain: Number,
      loss: Number
    }
  },
  weather: {
    forecast: [{
      date: Date,
      temperature: {
        min: Number,
        max: Number,
        current: Number
      },
      description: String,
      icon: String,
      humidity: Number,
      windSpeed: Number,
      precipitation: Number
    }]
  },
  image: {
    url: String,
    alt: String
  },
  status: {
    type: String,
    enum: ['planned', 'completed', 'cancelled'],
    default: 'planned'
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true
  }],
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot be more than 1000 characters']
  }
}, {
  timestamps: true
});

// Indexes
routeSchema.index({ user: 1, createdAt: -1 });
routeSchema.index({ tripType: 1 });
routeSchema.index({ 'location.country': 1, 'location.city': 1 });
routeSchema.index({ status: 1 });
// Geo index for the route line (optional but useful)
routeSchema.index({ 'routeData.geometry': '2dsphere' });

// Virtuals (formatted from presentTotals)
routeSchema.virtual('formattedDistance').get(function () {
  const t = presentTotals(this.routeData || {});
  return t.formattedDistance;
});

routeSchema.virtual('formattedDuration').get(function () {
  const t = presentTotals(this.routeData || {});
  return t.formattedDuration;
});

// Methods
routeSchema.methods.getSummary = function () {
  const d = this.toObject();
  const totals = presentTotals(d.routeData || {});
  return {
    id: d._id,
    name: d.name,
    description: d.description,
    tripType: d.tripType,
    location: d.location,
    // Expose formatted strings for list UI
    formattedDistance: totals.formattedDistance,
    formattedDuration: totals.formattedDuration,
    image: d.image,
    status: d.status,
    createdAt: d.createdAt,
    weather: d.weather
  };
};

routeSchema.methods.getDetailed = function () {
  const d = this.toObject();
  const totals = presentTotals(d.routeData || {});
  return {
    id: d._id,
    name: d.name,
    description: d.description,
    tripType: d.tripType,
    location: d.location,
    routeData: d.routeData,
    // Expose both numeric and formatted totals for detail page
    totalDistanceKm: totals.totalDistanceKm,
    totalDurationHours: totals.totalDurationHours,
    totalDistanceMeters: totals.totalDistanceMeters,
    totalDurationSeconds: totals.totalDurationSeconds,
    formattedDistance: totals.formattedDistance,
    formattedDuration: totals.formattedDuration,
    weather: d.weather,
    image: d.image,
    status: d.status,
    tags: d.tags,
    rating: d.rating,
    notes: d.notes,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
};

// Ensure virtuals are included when converting to JSON
routeSchema.set('toJSON', { virtuals: true });
routeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Route', routeSchema);
