const Route = require('../models/Route');
const { asyncHandler } = require('../middleware/errorHandler');
const { validationResult } = require('express-validator');
const normalizeRouteData = require('./normalizeRouteData');
const mongoose = require('mongoose');

/** Canonicalize totals on save/update (meters/seconds),
 * while accepting legacy km/hours if that's what the client sent.
 */
function canonicalizeTotals(rd = {}) {
  const out = { ...rd };

  // Distance
  const rawDist = Number(out.totalDistanceMeters ?? out.totalDistance);
  if (Number.isFinite(rawDist)) {
    // if legacy km (small numbers) -> convert to meters
    out.totalDistanceMeters =
      out.totalDistanceMeters ?? (rawDist < 1000 ? rawDist * 1000 : rawDist);
  }

  // Duration
  const rawDur = Number(out.totalDurationSeconds ?? out.totalDuration);
  if (Number.isFinite(rawDur)) {
    // if legacy hours (small numbers) -> convert to seconds
    out.totalDurationSeconds =
      out.totalDurationSeconds ?? (rawDur < 1000 ? rawDur * 3600 : rawDur);
  }

  return out;
}

// @desc    Get all routes for current user
// @route   GET /api/routes
// @access  Private
const getRoutes = asyncHandler(async (req, res) => {
  const pageNum = Number(req.query.page || 1);
  const limitNum = Number(req.query.limit || 10);
  const { tripType, status } = req.query;

  const filter = { user: req.user.id };
  if (tripType) filter.tripType = tripType;
  if (status) filter.status = status;

  const routes = await Route.find(filter)
    .sort({ createdAt: -1 })
    .limit(limitNum)
    .skip((pageNum - 1) * limitNum)
    .exec();

  const count = await Route.countDocuments(filter);

  res.json({
    success: true,
    data: {
      routes: routes.map(route => route.getSummary()),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalRoutes: count,
        hasNextPage: pageNum * limitNum < count,
        hasPrevPage: pageNum > 1
      }
    }
  });
});

// @desc    Get single route
// @route   GET /api/routes/:id
// @access  Private
const getRoute = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ success: false, message: 'Route not found' });
  if (route.user.toString() !== req.user.id)
    return res.status(403).json({ success: false, message: 'Not authorized to access this route' });

  // Normalize on read to heal old records
  const { routeData: normalizedRD, center } = normalizeRouteData(route.routeData, route.location);

  const detailed = route.getDetailed();
  detailed.routeData = normalizedRD;
  detailed.center = center;

  res.json({ success: true, data: { route: detailed } });
});

// @desc    Create new route
// @route   POST /api/routes
// @access  Private
const createRoute = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const {
    name,
    description,
    tripType,
    location,
    routeData,
    weather,
    image,
    tags,
    notes
  } = req.body;

  // Normalize before persisting, then canonicalize totals
  const { routeData: normalizedRD } = normalizeRouteData(routeData, location);
  const rd = canonicalizeTotals(normalizedRD);

  const route = await Route.create({
    user: req.user.id,
    name,
    description,
    tripType,
    location,
    routeData: rd,
    weather,
    image,
    tags,
    notes
  });

  res.status(201).json({
    success: true,
    data: {
      route: route.getDetailed()
    },
    message: 'Route created successfully'
  });
});

// @desc    Update route
// @route   PUT /api/routes/:id
// @access  Private
const updateRoute = asyncHandler(async (req, res) => {
  let route = await Route.findById(req.params.id);

  if (!route) {
    return res.status(404).json({
      success: false,
      message: 'Route not found'
    });
  }

  if (route.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to update this route'
    });
  }

  const {
    name,
    description,
    tripType,
    location,
    routeData,
    weather,
    image,
    status,
    tags,
    rating,
    notes
  } = req.body;

  // Apply simple fields
  if (name !== undefined) route.name = name;
  if (description !== undefined) route.description = description;
  if (tripType !== undefined) route.tripType = tripType;
  if (weather !== undefined) route.weather = weather;
  if (image !== undefined) route.image = image;
  if (status !== undefined) route.status = status;
  if (tags !== undefined) route.tags = tags;
  if (rating !== undefined) route.rating = rating;
  if (notes !== undefined) route.notes = notes;

  // Normalize routeData using the most up-to-date location, then canonicalize totals
  const nextLocation = location !== undefined ? location : route.location;
  if (location !== undefined) route.location = location;

  if (routeData !== undefined) {
    const { routeData: normalizedRD } = normalizeRouteData(routeData, nextLocation);
    route.routeData = canonicalizeTotals(normalizedRD);
  }

  const updatedRoute = await route.save();

  res.json({
    success: true,
    data: {
      route: updatedRoute.getDetailed()
    },
    message: 'Route updated successfully'
  });
});

// @desc    Delete route
// @route   DELETE /api/routes/:id
// @access  Private
const deleteRoute = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid route id'
    });
  }

  const deleted = await Route.findOneAndDelete({ _id: id, user: req.user.id });

  if (!deleted) {
    return res.status(404).json({
      success: false,
      message: 'Route not found'
    });
  }

  return res.json({
    success: true,
    message: 'Route deleted successfully'
  });
});

// @desc    Get route statistics
// @route   GET /api/routes/stats
// @access  Private
const getRouteStats = asyncHandler(async (req, res) => {
  const stats = await Route.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(req.user.id) } },
    {
      $group: {
        _id: null,
        totalRoutes: { $sum: 1 },

        // Sum canonical meters/seconds; if missing, convert legacy km/hours
        totalDistanceMeters: {
          $sum: {
            $cond: [
              { $ifNull: ['$routeData.totalDistanceMeters', false] },
              '$routeData.totalDistanceMeters',
              { $multiply: [{ $ifNull: ['$routeData.totalDistance', 0] }, 1000] }
            ]
          }
        },
        totalDurationSeconds: {
          $sum: {
            $cond: [
              { $ifNull: ['$routeData.totalDurationSeconds', false] },
              '$routeData.totalDurationSeconds',
              { $multiply: [{ $ifNull: ['$routeData.totalDuration', 0] }, 3600] }
            ]
          }
        },

        hikingRoutes: { $sum: { $cond: [{ $eq: ['$tripType', 'hiking'] }, 1, 0] } },
        cyclingRoutes: { $sum: { $cond: [{ $eq: ['$tripType', 'cycling'] }, 1, 0] } },
        completedRoutes: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        plannedRoutes: { $sum: { $cond: [{ $eq: ['$status', 'planned'] }, 1, 0] } }
      }
    }
  ]);

  const base = stats[0] || {
    totalRoutes: 0,
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    hikingRoutes: 0,
    cyclingRoutes: 0,
    completedRoutes: 0,
    plannedRoutes: 0
  };

  const totalDistanceKm = base.totalDistanceMeters / 1000;
  const totalDurationHours = base.totalDurationSeconds / 3600;

  res.json({
    success: true,
    data: {
      stats: {
        totalRoutes: base.totalRoutes,
        hikingRoutes: base.hikingRoutes,
        cyclingRoutes: base.cyclingRoutes,
        completedRoutes: base.completedRoutes,
        plannedRoutes: base.plannedRoutes,

        // Canonical totals
        totalDistanceMeters: base.totalDistanceMeters,
        totalDurationSeconds: base.totalDurationSeconds,

        // Human-friendly totals (backward-friendly names)
        totalDistance: totalDistanceKm,       // km
        totalDuration: totalDurationHours,    // hours

        averageDistance: base.totalRoutes > 0 ? totalDistanceKm / base.totalRoutes : 0,
        averageDuration: base.totalRoutes > 0 ? totalDurationHours / base.totalRoutes : 0
      }
    }
  });
});

module.exports = {
  getRoutes,
  getRoute,
  createRoute,
  updateRoute,
  deleteRoute,
  getRouteStats
};
